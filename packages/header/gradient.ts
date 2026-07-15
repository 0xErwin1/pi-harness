export type Rgb = [number, number, number];

const RESET = "\x1b[0m";

/**
 * The Ayu-flavored gradient sampled per cell for the truecolor header.
 *
 * This is the ONLY surface in the harness permitted to emit a 24-bit gradient:
 * the hybrid aesthetic keeps the footer and subagent UI on flat Ayu theme roles
 * and confines the rainbow to the startup banner. The stops loop (blue → cyan →
 * gold → orange → cyan → blue) so a per-row phase shift reads as a smooth flow.
 */
export const PALETTE: readonly Rgb[] = [
	[89, 194, 255], // ayu blue   #59C2FF
	[149, 230, 203], // ayu cyan   #95E6CB
	[255, 209, 115], // ayu yellow #FFD173
	[255, 180, 84], // ayu orange #FFB454
	[255, 209, 115], // ayu yellow #FFD173
	[149, 230, 203], // ayu cyan   #95E6CB
];

function mix(start: number, end: number, amount: number): number {
	return Math.round(start + (end - start) * amount);
}

/** Samples the looping palette at a normalized position (positions wrap into [0,1)). */
export function sampleGradient(position: number): Rgb {
	const wrapped = ((position % 1) + 1) % 1;
	const scaled = wrapped * PALETTE.length;
	const index = Math.floor(scaled) % PALETTE.length;
	const nextIndex = (index + 1) % PALETTE.length;
	const amount = scaled - Math.floor(scaled);

	const start = PALETTE[index]!;
	const end = PALETTE[nextIndex]!;

	return [mix(start[0], end[0], amount), mix(start[1], end[1], amount), mix(start[2], end[2], amount)];
}

/** Wraps text in a 24-bit foreground SGR sequence, reset at the end. */
export function foreground([red, green, blue]: Rgb, text: string): string {
	return `\x1b[38;2;${red};${green};${blue}m${text}${RESET}`;
}

/**
 * Colors each non-space character along the gradient. `phase` shifts the
 * sampling origin so successive rows appear to flow diagonally. Spaces are left
 * untouched so the surrounding layout never inherits a stray color.
 */
export function gradientText(text: string, phase: number): string {
	const characters = [...text];
	const span = Math.max(characters.length - 1, 1);

	return characters
		.map((character, index) =>
			character === " " ? character : foreground(sampleGradient(index / span + phase), character),
		)
		.join("");
}
