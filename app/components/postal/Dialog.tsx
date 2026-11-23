// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

export function Modal({ className = "", label, onClose, children }: { className?: string; label: string; onClose: () => void; children: React.ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Escape in a search box with text clears the box, and a step inside the dialog can take Escape for itself.
				if (e.target instanceof HTMLInputElement && e.target.type === "search" && e.target.value) return;
				if (e.target instanceof Element && e.target.closest("[data-own-escape]")) return;
				e.preventDefault();
				onClose();
			} else if (e.key === "Tab" && ref.current) {
				const items = [...ref.current.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex='0']")].filter((el) => !el.hasAttribute("disabled"));
				if (!items.length) return;
				const first = items[0];
				const last = items[items.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			previous?.focus?.();
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps
	return (
		<div className="pg-modal-scrim" onClick={onClose}>
			<div ref={ref} className={`pg-modal ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
				{children}
			</div>
		</div>
	);
}

/** A dialog's head. `children` sit between the title and the close button, such as a step tracker. */
export function Head({ icon, title, sub, onClose, danger, children }: { icon: React.ReactNode; title: string; sub?: string; onClose: () => void; danger?: boolean; children?: React.ReactNode }) {
	return (
		<div className="pg-modal-head">
			<span className={`pg-modal-icon${danger ? " is-danger" : ""}`}>{icon}</span>
			<div className="pg-modal-title">
				<h2>{title}</h2>
				{sub && <span>{sub}</span>}
			</div>
			{children}
			<button type="button" className="pg-modal-x" title="Close (Esc)" aria-label="Close" onClick={onClose}><XIcon size={16} /></button>
		</div>
	);
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
	return (
		<button type="button" role="switch" aria-checked={on} aria-label={label} className="pg-switch" disabled={disabled} onClick={() => onChange(!on)}>
			<span />
		</button>
	);
}

