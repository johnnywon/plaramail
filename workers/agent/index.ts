// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
	streamText,
	generateText,
	convertToModelMessages,
	createUIMessageStreamResponse,
	stepCountIs,
} from "ai";
import { z } from "zod";
import { HeaderValueSchema } from "../lib/schemas";
import { verifyDraft } from "../lib/ai";
import { agentModel } from "../lib/agent-model";
import { CHAT_STEP_LIMIT, chatPrepareStep, withStepLimitLine } from "./chat-steps";
import { pruneHistory } from "./chat-history";
import { mailStore, recordsSql } from "../store";
import { logActivity } from "../lib/activity";
import {
	toolDeleteLabel,
	toolRenameLabel,
	toolCreateLabel,
	toolListEmails,
	toolGetEmail,
	toolGetThread,
	toolSearchEmails,
	toolDraftReply,
	toolDraftEmail,
	toolMarkEmailRead,
	toolMoveEmail,
	toolDiscardDraft,
	toolSendDraft,
	toolListLabels,
	toolListShortcuts,
	toolSetShortcut,
	toolResetShortcuts,
	SHORTCUT_TOOL_DESCRIPTIONS,
	toolLabelConversation,
	toolStarConversation,
	toolLabelMatching,
	toolSearchAllMail,
	LABEL_MATCHING_MAX,
	SEARCH_HELP,
} from "../lib/tools";
import { DATE_TOKENS, VIEWS } from "../lib/mail-index-sql";
import { Folders, FOLDER_TOOL_DESCRIPTION, MOVE_FOLDER_TOOL_DESCRIPTION } from "../../shared/folders";
import { SHARED_AGENT, promptAddress, resolveMailbox, sharedAgentNote, type AgentContext } from "../../shared/agent";
import type { DraftNotes } from "../../shared/draft-notes";
import type { Env } from "../types";
import { defineTool, logTools } from "./tool-def";
import { getSystemPrompt } from "./prompt";
import { autoDraftPrompt, createAutoDraftTools, prepareAutoDraft, saveTextDraft } from "./auto-draft";
import { type AutoDraftTarget, type DraftOutcome, discardRunDrafts, outcomeAfterError, settleDrafts, watchedReason } from "./runs";
import { type Agent, agentSendsToday, listAgents, matchAgents } from "../lib/agents";
import { readPrefs } from "../lib/prefs";
import type { Unmatched } from "../../shared/prefs";

const CHAT_NOTES: DraftNotes = { origin: "chat", agent: null, instructions: [] };

/**
 * The chat agent's tools. crossAddress adds tools that search and label across
 * every address. Auto-draft, which reads untrusted incoming mail, never gets
 * these: it has its own three tools in ./auto-draft.ts.
 */
function createEmailTools(env: Env, bound: string | null, { crossAddress = false, known = [] as string[] } = {}) {
	// Cross-address agents name the address on each call; auto-draft stays on its own.
	const where = (description: string): z.ZodRawShape =>
		crossAddress
			? { mailboxId: bound ? z.string().optional().describe(`${description} Defaults to ${bound}.`) : z.string().describe(description) }
			: {};
	const run = (named: string | undefined, fn: (mailboxId: string) => Promise<unknown>): Promise<unknown> => {
		if (!crossAddress) return fn(bound ?? "");
		const r = resolveMailbox(named, bound, known);
		return "error" in r ? Promise.resolve(r) : fn(r.mailboxId);
	};
	const IN = "The address the email is in. search_all_mail results include it.";
	return {
		list_emails: defineTool({
			description:
				"List emails in a folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id). Use folder='inbox' for received emails, 'sent' for sent emails.",
			parameters: z.object({
				...where("The address whose folder to list."),
				folder: z
					.string()
					.default(Folders.INBOX)
					.describe(FOLDER_TOOL_DESCRIPTION),
				limit: z
					.number()
					.default(20)
					.describe("Maximum number of emails to return"),
				page: z
					.number()
					.default(1)
					.describe("Page number for pagination"),
			}),
			execute: async ({ mailboxId, folder, limit, page }): Promise<unknown> => {
				return run(mailboxId, (m) => toolListEmails(env, m, { folder, limit, page }));
			},
		}),

		get_email: defineTool({
			description:
				"Get a single email with its full body content and attachments. Use this to read the actual content of an email.",
			parameters: z.object({
				...where(IN),
				emailId: z.string().describe("The email ID to retrieve"),
			}),
			execute: async ({ mailboxId, emailId }): Promise<unknown> => {
				return run(mailboxId, (m) => toolGetEmail(env, m, emailId));
			},
		}),

		get_thread: defineTool({
			description:
				"Get all emails in a conversation thread. This is essential for understanding the full context of a conversation before drafting a response. Returns all messages sorted chronologically.",
			parameters: z.object({
				...where(IN),
				threadId: z
					.string()
					.describe(
						"The thread_id to retrieve all messages for. Get this from an email's thread_id field.",
					),
			}),
			execute: async ({ mailboxId, threadId }): Promise<unknown> => {
				return run(mailboxId, (m) => toolGetThread(env, m, threadId));
			},
		}),

		search_emails: defineTool({
			description:
				"Search one address's conversations. Same search and results as search_all_mail, limited to that address.",
			parameters: z.object({
				...where("The address to search. To search every address, use search_all_mail."),
				query: z.string().describe(`Search text. ${SEARCH_HELP}`),
				folder: z
					.string()
					.optional()
					.describe("Optional folder or view to restrict the search to"),
			}),
			execute: async ({ mailboxId, query, folder }): Promise<unknown> => {
				return run(mailboxId, (m) => toolSearchEmails(env, m, { query, folder }));
			},
		}),

		draft_email: defineTool({
			description:
				"Draft a new email (not a reply) and save it to the Drafts folder. Use send_draft to send it. Write the body as plain text — no HTML tags.",
			parameters: z.object({
				...where("The address to send from."),
				to: z.string().email().describe("Recipient email address"),
				subject: HeaderValueSchema
					.describe("Subject line"),
				body: z
					.string()
					.describe(
						"The plain text body of the email. No HTML — just write normally.",
					),
			}),
			execute: async ({ mailboxId, to, subject, body }): Promise<unknown> => {
				return run(mailboxId, (m) => toolDraftEmail(env, m, {
					to,
					subject,
					body,
					isPlainText: true,
					notes: CHAT_NOTES,
				}));
			},
		}),

		draft_reply: defineTool({
			description:
				"Draft a reply to an existing email and save it to the Drafts folder. Use send_draft to send it. Write the body as plain text — no HTML tags.",
			parameters: z.object({
				...where("The address the original email is in. The reply is sent from it."),
				originalEmailId: z
					.string()
					.describe("The ID of the email being replied to"),
				to: z.string().email().describe("Recipient email address"),
				subject: HeaderValueSchema
					.describe("Subject line (usually 'Re: ...')"),
				body: z
					.string()
					.describe(
						"The plain text body of the reply. No HTML — just write normally.",
					),
			}),
			execute: async ({ mailboxId, originalEmailId, to, subject, body }): Promise<unknown> => {
				return run(mailboxId, (m) => toolDraftReply(env, m, {
					originalEmailId,
					to,
					subject,
					body,
					isPlainText: true,
					runVerifyDraft: true,
					notes: CHAT_NOTES,
				}));
			},
		}),

		mark_email_read: defineTool({
			description: "Mark an email as read or unread.",
			parameters: z.object({
				...where(IN),
				emailId: z.string().describe("The email ID"),
				read: z
					.boolean()
					.describe("true to mark as read, false for unread"),
			}),
			execute: async ({ mailboxId, emailId, read }): Promise<unknown> => {
				return run(mailboxId, (m) => toolMarkEmailRead(env, m, emailId, read));
			},
		}),

		move_email: defineTool({
			description:
				"Move an email to a different folder (inbox, sent, draft, archive, trash).",
			parameters: z.object({
				...where(IN),
				emailId: z.string().describe("The email ID"),
				folderId: z
					.string()
					.describe(MOVE_FOLDER_TOOL_DESCRIPTION),
			}),
			execute: async ({ mailboxId, emailId, folderId }): Promise<unknown> => {
				return run(mailboxId, (m) => toolMoveEmail(env, m, emailId, folderId));
			},
		}),

		list_labels: defineTool({
			description:
				"List labels with their ids, colours and conversation counts. Labels are tags shared by every mailbox.",
			parameters: z.object({}),
			execute: async (): Promise<unknown> => {
				return toolListLabels(env);
			},
		}),

		create_label: defineTool({
			description:
				"Create a label shared by every mailbox. If a label with that name exists, it is returned instead. Then apply it with label_conversation.",
			parameters: z.object({
				name: z.string().min(1).max(60).describe("Label name, short and in title case, e.g. Receipts"),
			}),
			execute: async ({ name }): Promise<unknown> => {
				return toolCreateLabel(env, { name });
			},
		}),

		rename_label: defineTool({
			description: "Rename a label. Conversations keep it under the new name.",
			parameters: z.object({
				label: z.string().describe("The label's id or current name"),
				name: z.string().min(1).max(60).describe("The new name"),
			}),
			execute: async ({ label, name }): Promise<unknown> => {
				return toolRenameLabel(env, { label, name });
			},
		}),

		list_shortcuts: defineTool({
			description: SHORTCUT_TOOL_DESCRIPTIONS.list,
			parameters: z.object({}),
			execute: async (): Promise<unknown> => toolListShortcuts(env),
		}),

		set_shortcut: defineTool({
			description: SHORTCUT_TOOL_DESCRIPTIONS.set,
			parameters: z.object({
				shortcut: z.string().describe(SHORTCUT_TOOL_DESCRIPTIONS.shortcut),
				keys: z.array(z.string()).max(2).describe(SHORTCUT_TOOL_DESCRIPTIONS.keys),
			}),
			execute: async ({ shortcut, keys }): Promise<unknown> => toolSetShortcut(env, { shortcut, keys }),
		}),

		reset_shortcuts: defineTool({
			description: SHORTCUT_TOOL_DESCRIPTIONS.reset,
			parameters: z.object({
				shortcut: z.string().optional().describe(SHORTCUT_TOOL_DESCRIPTIONS.shortcut),
			}),
			execute: async ({ shortcut }): Promise<unknown> => toolResetShortcuts(env, { shortcut }),
		}),

		delete_label: defineTool({
			description:
				"Delete a label. It is removed from every conversation that carries it; the mail itself stays. This cannot be undone, so only use it when the operator asks to delete that label.",
			parameters: z.object({
				label: z.string().describe("The label's id or name"),
			}),
			execute: async ({ label }): Promise<unknown> => {
				return toolDeleteLabel(env, { label });
			},
		}),

		label_conversation: defineTool({
			description:
				"Add or remove labels on the conversation that holds an email. Labeling leaves the conversation where it is unless archive is true.",
			parameters: z.object({
				...where(IN),
				emailId: z.string().describe("Any email ID in the conversation"),
				add: z.array(z.string()).optional().describe("Label ids or names to add"),
				remove: z.array(z.string()).optional().describe("Label ids or names to remove"),
				archive: z.boolean().optional().describe("Also move the conversation's Inbox mail to Archive"),
			}),
			execute: async ({ mailboxId, emailId, add, remove, archive }): Promise<unknown> => {
				return run(mailboxId, (m) => toolLabelConversation(env, m, emailId, { add, remove, archive }));
			},
		}),

		star_conversation: defineTool({
			description: "Star or unstar the conversation that holds an email. Starring marks its latest message; unstarring clears every message.",
			parameters: z.object({
				...where(IN),
				emailId: z.string().describe("Any email ID in the conversation"),
				starred: z.boolean().describe("true to star, false to unstar"),
			}),
			execute: async ({ mailboxId, emailId, starred }): Promise<unknown> => {
				return run(mailboxId, (m) => toolStarConversation(env, m, emailId, starred));
			},
		}),

		...(crossAddress ? crossAddressTools(env) : {}),

		discard_draft: defineTool({
			description:
				"Delete a draft email. Use this to discard drafts that are no longer needed or were rejected by the operator.",
			parameters: z.object({
				...where("The address the draft is in."),
				draftId: z.string().describe("The ID of the draft to delete"),
			}),
			execute: async ({ mailboxId, draftId }): Promise<unknown> => {
				return run(mailboxId, (m) => toolDiscardDraft(env, m, draftId));
			},
		}),
		// Only the chat agent sends. Auto-draft reads untrusted mail and only drafts.
		...(crossAddress
			? {
				send_draft: defineTool({
					description:
						"Send a saved draft now and remove it from Drafts. A reply draft is sent in its thread. A draft that was already sent returns \"Draft not found\" and is not sent again.",
					parameters: z.object({
						...where("The address the draft is in. It is sent from that address."),
						draftId: z.string().describe("The ID of the draft to send"),
					}),
					execute: async ({ mailboxId, draftId }): Promise<unknown> => {
						return run(mailboxId, (m) => toolSendDraft(env, m, draftId, "agent"));
					},
				}),
			}
			: {}),
	};
}

const mailSearchSchema = {
	query: z.string().optional().describe(`Search text. ${SEARCH_HELP}`),
	from: z.array(z.string()).optional().describe("Sender addresses or domains, e.g. receipts@example.com or example.com"),
	to: z.array(z.string()).optional().describe("Your addresses or domains the mail was delivered to. Leave out for every address."),
	label: z.array(z.string()).optional().describe("Only conversations that already carry these labels (ids or names)"),
	folder: z.enum(VIEWS).optional().describe("Folder to search. Defaults to all, which covers every folder except Spam and Trash; anywhere includes them."),
	unread: z.boolean().optional().describe("true for unread only, false for read only"),
	starred: z.boolean().optional(),
	hasAttachment: z.boolean().optional(),
	date: z.enum(DATE_TOKENS).optional().describe("today, yesterday, 7d, 30d or older"),
};

function crossAddressTools(env: Env) {
	return {
		search_all_mail: defineTool({
			description:
				"Search conversations across every address at once. Each result gives its mailboxId and emailId. Use this, not search_emails, whenever the operator means all their mail.",
			parameters: z.object({ ...mailSearchSchema, limit: z.number().int().min(1).max(50).optional() }),
			execute: async (search): Promise<unknown> => toolSearchAllMail(env, search),
		}),
		label_matching: defineTool({
			description:
				`Add or remove labels on every conversation that matches a search, across all addresses, in one call. Up to ${LABEL_MATCHING_MAX} conversations. Run search_all_mail with the same search first to check what matches.`,
			parameters: z.object({
				...mailSearchSchema,
				add: z.array(z.string()).optional().describe("Label ids or names to add"),
				remove: z.array(z.string()).optional().describe("Label ids or names to remove"),
				archive: z.boolean().optional().describe("Also move the matching Inbox mail to Archive"),
			}),
			execute: async ({ add, remove, archive, ...search }): Promise<unknown> => toolLabelMatching(env, search, { add, remove, archive }),
		}),
	};
}

/** A user line and an assistant line for the agent's chat history. */
function autoLog(userText: string, assistantText: string) {
	return [
		{ id: crypto.randomUUID(), role: "user" as const, content: userText, createdAt: new Date(), parts: [{ type: "text" as const, text: userText }] },
		{ id: crypto.randomUUID(), role: "assistant" as const, content: assistantText, createdAt: new Date(), parts: [{ type: "text" as const, text: assistantText }] },
	];
}

// Use `any` for the Env generic to avoid type conflicts between the custom
// SEND_EMAIL binding shape and the AIChatAgent constraint.  The actual env
// is fully typed inside the tools via the closure.
export class EmailAgent extends AIChatAgent<any> {
	async onChatMessage(onFinish: any, options?: { body?: AgentContext }) {
		const env = this.env as Env;
		// The chat panel uses the shared instance; per-address instances serve "Draft reply".
		const bound = this.name === SHARED_AGENT ? null : this.name;
		const known = (await mailStore(env).mailboxes.list()).map((m) => m.id.toLowerCase());
		const model = await agentModel(env, { chat: true });
		const tools = logTools(createEmailTools(env, bound, { crossAddress: true, known }), recordsSql(env), { actor: "chat", bound });
		// Each address has its own prompt. The shared panel uses the open mail's address.
		const prompt = await getSystemPrompt(env, promptAddress(bound, options?.body, known));
		const systemPrompt = bound ? prompt : `${prompt}\n\n${sharedAgentNote(known, options?.body)}`;

		const result = streamText({
			model,
			system: systemPrompt,
			// Old tool output and reasoning are cut before the run; every step resends this (#65).
			messages: pruneHistory(await convertToModelMessages(this.messages)),
			tools,
			stopWhen: stepCountIs(CHAT_STEP_LIMIT),
			prepareStep: chatPrepareStep(systemPrompt),
			onFinish,
		});

		// Reasoning isn't shown or kept (#61). A run that ran out of steps says so in the panel (#29).
		return createUIMessageStreamResponse({ stream: withStepLimitLine(result.toUIMessageStream({ sendReasoning: false })) });
	}

	/**
	 * Handle HTTP requests to the agent DO. Intercepts /onNewEmail
	 * before passing to the default AIChatAgent handler.
	 */
	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/onNewEmail" && request.method === "POST") {
			const result = await this.handleNewEmail(await request.json() as AutoDraftTarget);
			return new Response(JSON.stringify(result), {
				status: result.status === "error" ? 500 : 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return super.onRequest(request);
	}

	/**
	 * Draft a reply to a new email: read it and its thread, scan them, and let
	 * the model draft with the address's prompt. Called by the
	 * auto-draft queue (./queue.ts); an error result is retried there.
	 */
	async handleNewEmail(target: AutoDraftTarget): Promise<DraftOutcome> {
		const env = this.env as Env;
		const sql = recordsSql(env);

		// Read the email and its whole thread once and scan everything the
		// model will see. Any doubt skips the draft (auto-draft.ts).
		const stub = mailStore(env).mailbox(target.mailboxId);
		const prepared = await prepareAutoDraft(env.AI, stub, target);
		if (!prepared.ok) {
			console.warn(`Auto-draft skipped for ${target.emailId}: ${prepared.reason}`);
			// The subject is left out: it may be what failed the scan, and chat history reaches the chat agent.
			await this.persistMessages([
				...this.messages,
				...autoLog(`[Auto-triggered] New email from ${target.sender}`, `Skipped auto-draft: ${prepared.reason}.`),
			]);
			return { status: "skipped", reason: prepared.reason };
		}
		const context = prepared.context;
		const replyTo = context.replyTo;

		// Every draft saved, oldest first; an error after the first still counts as drafted.
		const draftIds: string[] = [];
		let matched: Agent[] = [];
		let unmatched: Unmatched = "leave";
		let chosen: string | null = null;
		try {
			const model = await agentModel(env, { reasoning: false });
			const systemPrompt = await getSystemPrompt(env, target.mailboxId);
			// Rules first, no model call: the agents that watch this address and whose rules pass.
			const [agents, { prefs }] = await Promise.all([listAgents(sql), readPrefs(env)]);
			unmatched = prefs.unmatched;
			matched = matchAgents(agents, {
				mailboxId: target.mailboxId, from: context.email.sender, subject: context.email.subject, body: context.email.body_text,
			});
			if (matched.length === 0 && prefs.unmatched === "leave") return { status: "skipped", reason: "no agent takes this mail" };
			// The model reads the jobs of the agents that passed and drafts for one, or none. The last draft's agent is the one chosen.
			const tools = logTools(createAutoDraftTools(env, {
				mailboxId: target.mailboxId,
				emailId: target.emailId,
				threadId: target.threadId,
				to: replyTo,
			}, context, toolDraftReply, { agents: matched, onDraft: (id, agent) => { draftIds.push(id); chosen = agent; } }), sql, { actor: "auto-draft", bound: target.mailboxId });
			const autoPrompt = autoDraftPrompt(target.mailboxId, target.threadId, context, matched)
				+ (matched.length > 0 && prefs.unmatched === "leave" ? "\n\nIf no agent's job fits the new email, write no draft." : "");

			// Fresh context for auto-draft: no prior chat history, so old
			// messages and tool calls don't confuse the model.
			const messages = [
				{
					role: "user" as const,
					content: autoPrompt,
					parts: [{ type: "text" as const, text: autoPrompt }],
					createdAt: new Date(),
				},
			];

			const result = await generateText({
				model,
				system: systemPrompt,
				messages: await convertToModelMessages(messages),
				tools,
				stopWhen: stepCountIs(5),
			});

			// No draft_reply call: save the model's text as the draft, once verifyDraft keeps something.
			if (!draftIds.length && result.text.trim()) {
				const sanitizedText = await verifyDraft(env.AI, result.text.trim());
				if (sanitizedText) {
					await saveTextDraft(stub, sql, { ...target, to: replyTo }, context.email.subject, sanitizedText, (id) => draftIds.push(id));
				}
			}

			await this.persistMessages([
				...this.messages,
				...autoLog(
					`[Auto-triggered] New email from ${target.sender}: "${context.email.subject}"`,
					draftIds.length ? `Created draft reply to ${replyTo}.` : "No draft: the model wrote nothing to send.",
				),
			]);

			return await this.settle(draftIds, chosen, matched, unmatched, target);
		} catch (e) {
			console.error("Auto-draft failed:", (e as Error).message);
			if (!draftIds.length) return outcomeAfterError(e, draftIds);
			// Drafts saved before the error still go to the chosen agent: Watch discards its draft.
			try {
				return await this.settle(draftIds, chosen, matched, unmatched, target);
			} catch (settleError) {
				console.error("Auto-draft settle failed:", (settleError as Error).message);
				return outcomeAfterError(e, draftIds);
			}
		}
	}

	private async settle(draftIds: string[], chosen: string | null, matched: Agent[], unmatched: Unmatched, target: AutoDraftTarget): Promise<DraftOutcome> {
		const agent = chosen ? matched.find((a) => a.name === chosen) ?? null : null;
		const settled = settleDrafts(draftIds, agent, matched.length, unmatched);
		const why = "outcome" in settled && settled.outcome.status === "skipped" ? settled.outcome.reason : "an earlier draft from this run";
		await discardRunDrafts(recordsSql(this.env as Env), (m, id) => toolDiscardDraft(this.env as Env, m, id), target.mailboxId, settled.discard, why);
		return "outcome" in settled ? settled.outcome : await this.actAs(agent!, settled.act, target);
	}

	/**
	 * What an agent's mode does with the reply it wrote: Watch keeps a note of
	 * it and discards the draft, Draft leaves it in Drafts, Send sends it
	 * within the agent's limits. A send that can't go out stays a draft.
	 */
	private async actAs(agent: Agent, draftId: string, target: AutoDraftTarget): Promise<DraftOutcome> {
		const env = this.env as Env;
		if (agent.mode === "watch") {
			const draft = await mailStore(env).mailbox(target.mailboxId).getEmail(draftId);
			// A draft that couldn't be discarded is still in Drafts: the run is not "watched".
			const discarded = await toolDiscardDraft(env, target.mailboxId, draftId);
			if ("error" in discarded && discarded.error !== "Draft not found") throw new Error(`Watch draft not discarded: ${String(discarded.error)}`);
			await logActivity(recordsSql(env), { actor: "auto-draft", tool: "discard_draft", mailboxId: target.mailboxId, target: draftId, summary: "discarded, Watch mode keeps a note instead", ok: true });
			return { status: "watched", agentId: agent.id, reason: watchedReason(String(draft?.body ?? "")) };
		}
		if (agent.mode === "draft") return { status: "drafted", draftId, agentId: agent.id };
		const sends = await agentSendsToday(recordsSql(env), agent.id, target.sender);
		if (sends.total >= agent.dailyLimit) return { status: "drafted", draftId, agentId: agent.id, reason: `daily limit of ${agent.dailyLimit} reached; kept as a draft` };
		if (sends.toSender >= agent.perSenderLimit) return { status: "drafted", draftId, agentId: agent.id, reason: `replied to this sender ${sends.toSender} times today; kept as a draft` };
		const result = await toolSendDraft(env, target.mailboxId, draftId, "agent");
		if ("error" in result) return { status: "drafted", draftId, agentId: agent.id, reason: `not sent: ${result.error}` };
		return { status: "sent", draftId: null, agentId: agent.id };
	}
}
