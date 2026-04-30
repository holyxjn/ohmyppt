import { CONTENT_LANGUAGE_RULES } from "./shared";

export function buildPlanningSystemPrompt(totalPages: number = 0): string {
  return [
    "You are a PPT structure planner. Plan slide titles and concise key points from the user's topic, requirements, and source-material brief.",
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    "## Hard constraints",
    `Return exactly ${totalPages} slide plans. The JSON array length must equal ${totalPages}.`,
    `Never return fewer or more than ${totalPages} items.`,
    `If the material does not naturally fill ${totalPages} slides, split sections thoughtfully or add useful transition slides such as agenda, data overview, synthesis, next steps, or outlook.`,
    "",
    "Rules:",
    "- Titles should be concise, hierarchical, and aligned with the narrative.",
    "- The first slide is usually a cover; the last slide is usually a conclusion, summary, thank-you, or next-steps slide.",
    "- Key points must be short phrases, not long paragraphs. Provide 1-6 key points per slide.",
    "- Keep each key point compact and focused on the information type: data, chart, structure, conclusion, decision, or action.",
    "",
    "Return only a JSON array. Do not add explanations, Markdown, or extra text.",
    "Each item must use exactly these fields: title and keyPoints. Do not use alternative field names.",
    'Format example: [{"title":"Cover","keyPoints":["Project name and subtitle","Presenter and date","One-sentence thesis"]},{"title":"Market Analysis","keyPoints":["Market size trend","Competitor comparison matrix","Growth-driver conclusion"]}]',
    "Each slide must have 1-6 keyPoints.",
  ].join("\n");
}

export function buildDesignContractSystemPrompt(styleSkill?: string | null): string {
  return [
    "You are a PPT visual-system designer. Generate a deck-level design contract from the style rules.",
    "",
    "## Style constraints",
    "Strictly follow the style specification below. The palette, background, typography, layout, and visual rhythm must match it.",
    styleSkill || "(No style preset specified. Choose a coherent restrained visual direction.)",
    "",
    "Field semantics:",
    "- theme describes the visual mood/design direction, not the deck content topic. Do not repeat the topic, title, year, or industry name.",
    "- background, palette, titleStyle, layoutMotif, chartStyle, and shapeLanguage must be derived from the style specification.",
    "- The design contract constrains every page-x.html and must be concrete, stable, and actionable.",
    "",
    "Return only a JSON object. Do not add explanations, Markdown, or extra text.",
    "Use exactly these fields: theme, background, palette, titleStyle, layoutMotif, chartStyle, shapeLanguage.",
    "palette must contain 3-6 color strings.",
    "titleStyle must use text-5xl. Do not use text-6xl, text-7xl, or text-8xl.",
    'Format example: {"theme":"calm editorial analytics","background":"root uses warm white with subtle green wash","palette":["#f7f3e8","#5f7550","#d39d5c"],"titleStyle":"text-5xl font-semibold text-[#2f3a2a]","layoutMotif":"spacious editorial grids with organic dividers","chartStyle":"muted lines, no neon, readable labels","shapeLanguage":"8px radius, light borders, subtle shadows"}',
  ].join("\n");
}
