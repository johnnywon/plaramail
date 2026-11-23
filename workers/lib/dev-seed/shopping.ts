// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA only: things bought for the office and the home. Each order is a
// thread from confirmation to delivery, and a few go wrong: a wrong colour, a
// back-order, a return, an exchange. Plus the carts nobody finished.

import { note } from "./automated";
import { CO, type Company, type Ctx, convo, who } from "./cast";
import { type Attachment, type Msg, type Person, type When, button, card, esc, file, money, rows } from "./kit";

interface Stage {
	/** Hours after the order was placed. */
	h: number;
	subject: string;
	body: string;
	from?: Person;
	color?: string;
	attach?: Attachment[];
}

const LABELS = ["Receipts", "Shopping"];
const HOUR = 3_600_000;

/** One order as a thread: each stage that has happened by now is a message. */
function order(ctx: Ctx, o: { id: string; co: Company; local?: string; placed: When; stages: Stage[]; labels?: string[] }): Msg[] {
	const { clock } = ctx;
	const start = clock.at(o.placed);
	const out: Msg[] = [];
	for (const [i, s] of o.stages.entries()) {
		const t = start + s.h * HOUR;
		if (t > clock.now - 10 * 60_000) break;
		const from = s.from ?? at(o.co, o.local ?? "orders", o.co.name);
		out.push(note(ctx, {
			key: `${o.id}-${i + 1}`, box: "hello", from, at: t, labels: o.labels ?? LABELS, thread: `${o.id}-1`, replyTo: i ? `${o.id}-${i}` : undefined,
			subject: s.subject, attach: s.attach, html: card({ brand: from.name === o.co.name ? o.co.name : from.name, color: s.color ?? o.co.color, body: s.body }),
		}));
	}
	return out;
}

const at = (company: Company, local: string, name: string): Person => ({ name, addr: `${local}@${company.domain}` });

const items = (list: [string, number][], shipping: number) =>
	rows([...list.map(([n, p]) => [n, money(p)] as [string, string]), ["Shipping", shipping ? money(shipping) : "Free"], ["Total", money(list.reduce((s, [, p]) => s + p, 0) + shipping), "strong"]]);

const track = (code: string) => button("Track package", `https://${CO.parcelhop.domain}/track/${code}`, CO.parcelhop.color);

export function shoppingThreads(ctx: Ctx): Msg[] {
	const { clock, r } = ctx;
	const out: Msg[] = [];
	const code = () => `PH${r.int(10000000, 99999999)}US`;
	const label = (title: string, lines: string[]): Attachment => file.pdf("return-label.pdf", [
		{ t: title, size: 18, bold: true }, ...lines.map((t, i) => ({ t, gap: i === 0 ? 16 : 4 })),
		{ t: "[ barcode placeholder ]", size: 20, gap: 30 }, { t: "Sample document for development only.", gap: 30 },
	]);
	const day = (n: number) => n * 24;

	// Wren Outfitters: tent, wrong colour, replacement
	const t1 = code();
	const wrenStart = clock.at([17, "21:10"]);
	out.push(...order(ctx, { id: "wren", co: CO.wren, placed: [17, "21:10"], stages: [
		{ h: 0, subject: "Order #WR-77310 confirmed", body: `<h2 style="margin:0 0 8px;font-size:20px">Thanks, Morgan. We're getting it ready.</h2>${items([["Two-person tent, 3 season (Moss)", 189], ["Sleeping bag, 20F", 129], ["Headlamp, 300 lumen", 29]], 0)}<p>We'll email you when it ships.</p>` },
		{ h: 20, subject: "Your Wren Outfitters order has shipped", body: `<h2 style="margin:0 0 8px;font-size:20px">On its way</h2><p>Tracking number: <strong>${t1}</strong></p>${track(t1)}` },
		{ h: day(4) + 7, subject: `Out for delivery: ${t1}`, from: at(CO.parcelhop, "updates", "Parcelhop"), color: CO.parcelhop.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Arriving today</h2><p>Your package is on the truck and will arrive by 8 PM.</p>` },
		{ h: day(4) + 12, subject: `Delivered: ${t1}`, from: at(CO.parcelhop, "updates", "Parcelhop"), color: CO.parcelhop.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Delivered</h2><p>Left in the lobby at ${esc(clock.time(wrenStart + (day(4) + 12) * HOUR))}.</p>` },
		{ h: day(9), subject: "How's your gear? Tell us in 30 seconds", body: `<p>You bought the Two-person tent. How did it work out?</p>${button("Write a review", `https://${CO.wren.domain}/reviews`, CO.wren.color)}` },
	] }));

	const dani = who("Dani Okoye", CO.wren);
	out.push(...convo(ctx, { id: "wren-cs", box: "hello", subject: "Wrong color tent, order WR-77310", with: dani, labels: LABELS }, [
		{ me: true, at: [12, "19:30"], body: `Hi, my order WR-77310 arrived but the tent is Sand, not Moss. I ordered Moss and the packing slip says Moss. We're camping in a couple of weeks so I'd like the right one soon. Can you swap it?` },
		{ at: { after: 130 }, body: `Hi Morgan, sorry about that. It was a picking error on our side. I've attached a prepaid return label and I'm sending the Moss tent today by 2-day shipping, so you don't have to wait for the return to reach us.\n\nPlease drop the Sand one at any Parcelhop point within 14 days.\n\nDani\nWren Outfitters Support`, attach: [label("Wren Outfitters prepaid return", ["Return for order WR-77310", "Ship to: Wren Outfitters Returns, 200 Example Road", "Item: Two-person tent (Sand)"])] },
		{ me: true, at: { after: 1100 }, body: `Thank you, that's a fair fix. I'll drop it off tomorrow.` },
		{ at: { after: 2200 }, body: `Replacement is on its way. Tracking: ${code()}. Thanks for your patience.`, quote: false },
	]));

	// Abandoned cart: three nudges, three bigger discounts
	for (const [i, [ago, hhmm, subject, body]] of ([
		[6, "10:00", "You left something in your cart", "The Alpine camp stove is still waiting. Items in your cart aren't reserved, so don't wait too long."],
		[4, "10:00", "Still thinking it over? Here's 10% off", "The Alpine camp stove is still in your cart. Use code STOVE10 for 10% off."],
		[1, "09:00", "Last chance: 20% off your cart, today only", "Your cart expires tonight. Use code LASTCALL for 20% off the Alpine camp stove."],
	] as [number, string, string, string][]).entries()) {
		out.push(note(ctx, { key: `cart-${i + 1}`, box: "hello", from: at(CO.wren, "hello", "Wren Outfitters"), at: clock.at([ago, hhmm]), labels: ["Shopping"], thread: "cart-1", replyTo: i ? `cart-${i}` : undefined, subject,
			list: { id: `marketing.${CO.wren.domain}`, unsubscribe: `https://${CO.wren.domain}/unsubscribe` },
			html: card({ brand: "Wren Outfitters", color: CO.wren.color, body: `<h2 style="margin:0 0 8px;font-size:20px">${esc(subject)}</h2><p>${esc(body)}</p>${items([["Alpine camp stove", 74]], 0)}${button("Back to your cart", `https://${CO.wren.domain}/cart`, CO.wren.color)}`, footer: `<a href="https://${CO.wren.domain}/unsubscribe">Unsubscribe</a> from reminder emails.` }) }));
	}

	// Halcyon Home: a bookshelf that was back-ordered
	const newDate = clock.short(clock.nextDay(clock.at([29, "20:30"]), 14, "00:00"));
	const t2 = code();
	out.push(...order(ctx, { id: "halcyon", co: CO.halcyonhome, placed: [29, "20:30"], stages: [
		{ h: 0, subject: "Thanks for your order #HH-50218", body: `<h2 style="margin:0 0 8px;font-size:20px">Your order is in</h2>${items([["Oak bookshelf, 5 shelf", 349]], 79)}<p>Furniture ships by freight. We'll contact you to schedule delivery.</p>` },
		{ h: 72, subject: "An update on your order #HH-50218", body: `<h2 style="margin:0 0 8px;font-size:20px">A short delay</h2><p>The Oak bookshelf is back-ordered. The new estimate is <strong>${esc(newDate)}</strong>. You can cancel for a full refund until it ships.</p>${button("Manage order", `https://${CO.halcyonhome.domain}/orders/HH-50218`, CO.halcyonhome.color)}` },
		{ h: day(14), subject: "Your order #HH-50218 has shipped", body: `<h2 style="margin:0 0 8px;font-size:20px">It's coming</h2><p>Freight carrier: Northwind Freight. Reference <strong>${t2}</strong>. They'll call to schedule a delivery window.</p>` },
		{ h: day(15), subject: "Schedule your delivery for order #HH-50218", body: `<h2 style="margin:0 0 8px;font-size:20px">Pick a window</h2>${rows([["Option A", `${clock.short(clock.nextDay(clock.at([29, "20:30"]), 17, "00:00"))}, 8 AM to 12 PM`], ["Option B", `${clock.short(clock.nextDay(clock.at([29, "20:30"]), 17, "00:00"))}, 12 PM to 4 PM`], ["Option C", `${clock.short(clock.nextDay(clock.at([29, "20:30"]), 18, "00:00"))}, 8 AM to 12 PM`]])}` },
		{ h: day(15) + 20, subject: "Delivery confirmed: bookshelf, 8 AM to 12 PM", body: `<h2 style="margin:0 0 8px;font-size:20px">See you then</h2><p>Someone over 18 needs to be home. The team will place it in the room of your choice.</p>` },
		{ h: day(17) - 10, subject: "Delivered: how's your Oak bookshelf?", body: `<p>It should be in your home. If anything arrived damaged, tell us in 7 days.</p>${button("Report an issue", `https://${CO.halcyonhome.domain}/issues`, CO.halcyonhome.color)}` },
	] }));

	// Pine & Pixel: a monitor arm, a hub that runs hot, a return
	const t3 = code();
	out.push(...order(ctx, { id: "pine", co: CO.pinepixel, placed: [11, "13:05"], stages: [
		{ h: 0, subject: "Your Pine & Pixel order #PP-90417", body: `<h2 style="margin:0 0 8px;font-size:20px">Thanks for your order</h2>${items([["Monitor arm, single", 89], ["USB-C hub, 8 port", 54]], 0)}` },
		{ h: 30, subject: "Shipped: order #PP-90417", body: `<p>Your order shipped. Tracking: <strong>${t3}</strong></p>${track(t3)}` },
		{ h: day(3) + 6, subject: `Delivered: ${t3}`, from: at(CO.parcelhop, "updates", "Parcelhop"), color: CO.parcelhop.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Delivered</h2><p>Signed for at the front desk.</p>` },
	] }));
	const rin = who("Rin Takeda", CO.pinepixel);
	out.push(...convo(ctx, { id: "pine-cs", box: "hello", subject: "USB-C hub gets very hot (order PP-90417)", with: rin, labels: LABELS }, [
		{ me: true, at: [7, "09:20"], body: `Hello, the USB-C hub from order PP-90417 gets hot to the touch after about 20 minutes, even with only a keyboard and one drive plugged in. Is that normal? I don't feel safe leaving it on overnight.` },
		{ at: { after: 190 }, body: `Hi Morgan, no, that's not normal, and thank you for flagging it. Please unplug it. I've attached a return label. As soon as the carrier scans it, I'll issue your refund. If you'd like a replacement unit from a newer batch, say so.\n\nRin\nPine & Pixel Support`, attach: [label("Pine & Pixel return", ["RMA 22041", "Item: USB-C hub, 8 port", "Reason: overheating"])] },
		{ me: true, at: { after: 400 }, body: `Refund is fine. I'll drop it off today.` },
	]));
	out.push(
		note(ctx, { key: "pine-refund", box: "hello", from: at(CO.pinepixel, "orders", "Pine & Pixel"), at: clock.at([4, "11:15"]), labels: LABELS, thread: "pine-cs-1", replyTo: "pine-cs-3", subject: "Re: USB-C hub gets very hot (order PP-90417)",
			html: card({ brand: "Pine & Pixel", color: CO.pinepixel.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Refund issued</h2><p>We received your return for RMA 22041.</p>${rows([["Refund", money(54)], ["To", "Card ending 4417"], ["Expected", "3 to 5 business days"]])}` }) }),
		note(ctx, { key: "pine-price", box: "hello", from: at(CO.pinepixel, "alerts", "Pine & Pixel"), at: clock.at([3, "06:40"]), labels: ["Shopping"], subject: "Price drop on a monitor you watched",
			list: { id: `alerts.${CO.pinepixel.domain}`, unsubscribe: `https://${CO.pinepixel.domain}/unsubscribe` },
			html: card({ brand: "Pine & Pixel", color: CO.pinepixel.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Now $40 off</h2><p>The 27-inch 4K monitor you watched is ${money(329)}, down from ${money(369)}.</p>${button("See the monitor", `https://${CO.pinepixel.domain}/monitors`, CO.pinepixel.color)}`, footer: `<a href="https://${CO.pinepixel.domain}/unsubscribe">Unsubscribe</a> from price alerts.` }) }),
	);

	// Dog-Ear Books
	const t4 = code();
	out.push(...order(ctx, { id: "dogear", co: CO.dogear, placed: [6, "22:00"], stages: [
		{ h: 0, subject: "Order #DE-3391 received", body: `<h2 style="margin:0 0 8px;font-size:20px">Happy reading</h2>${items([["The Long Quiet (paperback)", 17], ["A Field Guide to Small Mammals", 24], ["Notes on Pricing", 28]], 4.5)}` },
		{ h: 22, subject: "Your books have shipped", body: `<p>Shipped via Media Mail. Tracking: <strong>${t4}</strong></p>${track(t4)}` },
		{ h: day(4) + 3, subject: `Delivered: ${t4}`, from: at(CO.parcelhop, "updates", "Parcelhop"), color: CO.parcelhop.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Delivered</h2><p>Left in the parcel locker.</p>` },
	] }));
	out.push(note(ctx, { key: "dogear-gift", box: "hello", from: at(CO.dogear, "orders", "Dog-Ear Books"), at: clock.at([24, "13:00"]), labels: LABELS, folder: "archive", read: true, subject: "Your gift card for Jules",
		html: card({ brand: "Dog-Ear Books", color: CO.dogear.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Your gift card is ready</h2>${rows([["For", "Jules Reyes"], ["Amount", money(50)], ["Message", "Happy birthday. Read something."]])}` }) }));

	// Fable Footwear: the size was wrong
	const sam = who("Sam Achebe", CO.fable);
	const t5 = code();
	out.push(...order(ctx, { id: "fable", co: CO.fable, placed: [34, "08:15"], stages: [
		{ h: 0, subject: "Order #FF-60822 confirmed", body: `<h2 style="margin:0 0 8px;font-size:20px">Nice choice</h2>${items([["Courier sneaker, white, size 10", 128]], 0)}` },
		{ h: 26, subject: "On its way: order #FF-60822", body: `<p>Tracking: <strong>${t5}</strong></p>${track(t5)}` },
		{ h: day(3) + 5, subject: `Delivered: ${t5}`, from: at(CO.parcelhop, "updates", "Parcelhop"), color: CO.parcelhop.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Delivered</h2>` },
	] }));
	out.push(...convo(ctx, { id: "fable-cs", box: "hello", subject: "Exchange: size 10 to 10.5 (order FF-60822)", with: sam, labels: LABELS, where: "archive" }, [
		{ me: true, at: [29, "18:40"], body: `Hi, I'd like to exchange the Courier sneakers from order FF-60822 for a size 10.5. The 10 is snug across the toe. They've been worn indoors for an hour.` },
		{ at: { after: 260 }, body: `Hi Morgan, sure, that's no problem. Tried-on shoes are fine. I've started the exchange for a 10.5 in white. The prepaid label is attached. We ship the new pair when the scan hits.\n\nSam, Fable Support`, attach: [label("Fable Footwear exchange", ["Exchange EX-4419", "Return: Courier sneaker, white, size 10", "Send: Courier sneaker, white, size 10.5"])] },
		{ me: true, at: { after: 1500 }, body: `Dropped off today. Thanks.` },
		{ at: { after: 5800 }, body: `Your 10.5 has shipped. Tracking number is in the order email. Hope they fit. If not, there's a second exchange on us.`, quote: false },
	]));
	out.push(note(ctx, { key: "fable-sale", box: "hello", from: at(CO.fable, "hello", "Fable Footwear"), at: clock.at([8, "07:00"]), labels: ["Shopping"], folder: "trash", read: true, subject: "Autumn sale: 30% off boots",
		list: { id: `marketing.${CO.fable.domain}`, unsubscribe: `https://${CO.fable.domain}/unsubscribe` },
		html: card({ brand: "Fable Footwear", color: CO.fable.color, body: `<h2 style="margin:0 0 8px;font-size:20px">Boots, 30% off</h2><p>This weekend only.</p>${button("Shop boots", `https://${CO.fable.domain}/boots`, CO.fable.color)}`, footer: `<a href="https://${CO.fable.domain}/unsubscribe">Unsubscribe</a>` }) }));

	// Bloom Market: flowers for Mom
	const t6 = code();
	out.push(...order(ctx, { id: "bloom", co: CO.bloom, placed: [7, "12:40"], stages: [
		{ h: 0, subject: "Your Bloom order #BM-1127 is confirmed", body: `<h2 style="margin:0 0 8px;font-size:20px">Flowers are on their way</h2>${rows([["Bouquet", "Peonies, mixed (large)"], ["Deliver to", "Elena Reyes"], ["Date", clock.short(clock.nextDay(clock.at([7, "12:40"]), 1, "00:00"))], ["Card", "Happy early birthday. Love, Morgan"], ["Total", money(73.99), "strong"]])}` },
		{ h: 6, subject: "Your flowers arrive tomorrow", body: `<p>The bouquet for Elena Reyes goes out tomorrow morning. We'll let you know once it's delivered.</p>` },
		{ h: 22.67, subject: "Delivered: your flowers reached Elena", body: `<h2 style="margin:0 0 8px;font-size:20px">Delivered</h2><p>Elena Reyes received your bouquet at 11:20 AM. Reply to share a photo of the thank-you.</p>` },
	] }));
	out.push(note(ctx, { key: "dogear-ebook", box: "hello", from: at(CO.dogear, "orders", "Dog-Ear Books"), at: clock.at([6, "22:02"]), labels: LABELS, read: true, subject: "Your ebook is ready to download",
		html: card({ brand: "Dog-Ear Books", color: CO.dogear.color, body: `<p>Your copy of <em>Notes on Pricing</em> (ebook) is ready. Download it from your library.</p>${button("Open library", `https://${CO.dogear.domain}/library`, CO.dogear.color)}` }) }));

	// A coffee scale that never shipped
	out.push(...order(ctx, { id: "tallow-late", co: CO.tallowoak, placed: [3, "16:00"], stages: [
		{ h: 0, subject: "Order #TO-49410 confirmed", body: `<h2 style="margin:0 0 8px;font-size:20px">Thanks for your order</h2>${items([["Pour-over kettle, matte black", 79]], 6.5)}` },
		{ h: 26, subject: "A small delay on order #TO-49410", body: `<p>The kettle is on back-order for a few days. We'll ship as soon as it arrives. You can cancel any time before it ships.</p>` },
	] }));
	return out;
}
