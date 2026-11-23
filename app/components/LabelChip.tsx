// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { labelTextColor } from "shared/label-colors";
import type { Label } from "~/services/api";

/**
 * Label color appears only as this filled chip or as an 8px+ square swatch.
 * The fill is an SVG rect behind the text, so it keeps square corners under
 * the global radius rule; the name stays HTML so it truncates and reads aloud.
 */
export function LabelChip({ label, children }: { label: Pick<Label, "name" | "color">; children?: React.ReactNode }) {
	return (
		<span className="mail-label-chip" style={{ color: labelTextColor(label.color) }} title={label.name}>
			<svg className="mail-label-fill" viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden focusable="false">
				<rect width="10" height="10" fill={label.color} />
			</svg>
			<span className="mail-label-name">{label.name}</span>
			{children}
		</span>
	);
}

/**
 * A square color swatch. Drawn as an SVG rect: the global 6px radius rule
 * would round a 10px box into a circle, and the rect keeps square corners
 * without a radius override.
 */
export function LabelSwatch({ color }: { color: string }) {
	return (
		<svg className="mail-label-swatch" viewBox="0 0 10 10" aria-hidden focusable="false">
			<rect x="0.5" y="0.5" width="9" height="9" fill={color} stroke="#0000004d" strokeWidth="1" />
		</svg>
	);
}
