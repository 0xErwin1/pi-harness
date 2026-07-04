import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { enterOverlay, exitOverlay } from "../../packages/shared/overlay-gate.ts";

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

export interface AskUserQuestionOption {
	label: string;
	description?: string;
}

export interface AskUserQuestionParams {
	question?: string;
	options?: Array<string | AskUserQuestionOption>;
	questions?: Array<{
		question: string;
		options: Array<string | AskUserQuestionOption>;
	}>;
}

export interface NormalizedAskUserQuestion {
	question: string;
	options: AskUserQuestionOption[];
}

export type AskUserQuestionStatus = "answered" | "cancelled" | "needs_user_answer";

export interface AskUserQuestionDetails {
	status: AskUserQuestionStatus;
	question: string;
	options: AskUserQuestionOption[];
	questions: NormalizedAskUserQuestion[];
	answers: Array<{ question: string; answer: string }>;
}

export interface AskUserQuestionToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: AskUserQuestionDetails;
}

const DEFAULT_OPTIONS = ["Yes", "No"];
const DEFAULT_QUESTION = "What should I do next?";

const AskUserQuestionParamsSchema = Type.Object({
	question: Type.Optional(Type.String()),
	options: Type.Optional(
		Type.Array(
			Type.Union([
				Type.String(),
				Type.Object({
					label: Type.String(),
					description: Type.Optional(Type.String()),
				}),
			]),
		),
	),
	questions: Type.Optional(
		Type.Array(
			Type.Object({
				question: Type.String(),
				options: Type.Array(
					Type.Union([
						Type.String(),
						Type.Object({
							label: Type.String(),
							description: Type.Optional(Type.String()),
						}),
					]),
				),
			}),
		),
	),
});

function normalizeOption(option: string | AskUserQuestionOption): AskUserQuestionOption {
	return typeof option === "string" ? { label: option } : option;
}

function normalizeQuestion(question: string | undefined): string {
	const trimmed = question?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : DEFAULT_QUESTION;
}

function normalizeOptions(options: Array<string | AskUserQuestionOption> | undefined): AskUserQuestionOption[] {
	const normalized = (options ?? DEFAULT_OPTIONS)
		.map(normalizeOption)
		.filter((option) => option.label.trim().length > 0);
	return normalized.length > 0 ? normalized : DEFAULT_OPTIONS.map((label) => ({ label }));
}

export function normalizeAskUserQuestionsParams(params: AskUserQuestionParams): NormalizedAskUserQuestion[] {
	if (params.questions && params.questions.length > 0) {
		return params.questions.map((item) => ({
			question: normalizeQuestion(item.question),
			options: normalizeOptions(item.options),
		}));
	}

	return [
		{
			question: normalizeQuestion(params.question),
			options: normalizeOptions(params.options),
		},
	];
}

export function normalizeAskUserQuestionParams(params: AskUserQuestionParams): NormalizedAskUserQuestion {
	return normalizeAskUserQuestionsParams(params)[0]!;
}

function formatQuestionText(normalized: NormalizedAskUserQuestion): string {
	return `${normalized.question} Options: ${normalized.options.map((option) => option.label).join(", ")}`;
}

function buildResult(
	status: AskUserQuestionStatus,
	questions: NormalizedAskUserQuestion[],
	answers: Array<{ question: string; answer: string }> = [],
	currentQuestion = questions[Math.min(answers.length, questions.length - 1)]!,
): AskUserQuestionToolResult {
	const text =
		status === "answered"
			? `User answered: ${answers.map((answer) => `"${answer.question}"="${answer.answer}"`).join("; ")}.`
			: status === "cancelled"
				? `User declined to answer: ${currentQuestion.question}`
				: `needs_user_answer: ${questions.map(formatQuestionText).join(" | ")}`;
	return {
		content: [{ type: "text", text }],
		details: {
			status,
			question: currentQuestion.question,
			options: currentQuestion.options,
			questions,
			answers,
		},
	};
}

export async function askUserQuestion(
	params: AskUserQuestionParams,
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
): Promise<AskUserQuestionToolResult> {
	const questions = normalizeAskUserQuestionsParams(params);
	if (!ctx.hasUI || typeof ctx.ui?.select !== "function") {
		return buildResult("needs_user_answer", questions);
	}

	const answers: Array<{ question: string; answer: string }> = [];
	enterOverlay();
	try {
		for (const normalized of questions) {
			const selected = await ctx.ui.select(
				normalized.question,
				normalized.options.map((option) => option.label),
			);
			if (selected === undefined) return buildResult("cancelled", questions, answers, normalized);
			answers.push({ question: normalized.question, answer: selected });
		}
		return buildResult("answered", questions, answers, questions[questions.length - 1]!);
	} finally {
		exitOverlay();
	}
}

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_USER_QUESTION_TOOL_NAME,
		label: "Ask User Question",
		description:
			"Ask the user one or more structured questions. Falls back to a needs_user_answer result when interactive UI is unavailable.",
		promptSnippet: "Ask the user a structured question when a decision is required.",
		promptGuidelines: [
			"Use ask_user_question only when a concrete user decision is needed before continuing.",
			"When the tool returns needs_user_answer, ask every listed question as plain chat instead of assuming a choice.",
		],
		parameters: AskUserQuestionParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return askUserQuestion(params as AskUserQuestionParams, ctx);
		},
	});
}

export default function rpivAskUserQuestion(pi: ExtensionAPI): void {
	registerAskUserQuestionTool(pi);
}
