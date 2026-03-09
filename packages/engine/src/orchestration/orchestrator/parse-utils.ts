import type { OrchestratorLLM } from './llm.js';

/**
 * Extract the outermost balanced JSON object from a string using brace counting.
 * Handles LLM responses that contain prose with curly braces before/after the JSON.
 * Tries each balanced candidate and returns the first one that parses as valid JSON.
 */
export function extractOuterJson(text: string): string | null {
  // Strip markdown code fences wrapping JSON
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1]!.trim() : text;

  let searchFrom = 0;

  while (searchFrom < cleaned.length) {
    const candidate = findBalancedBraces(cleaned, searchFrom);
    if (candidate) {
      try {
        JSON.parse(candidate.text);
        return candidate.text;
      } catch {
        searchFrom = candidate.start + 1;
        continue;
      }
    }

    // No balanced braces found — try to repair truncated JSON
    const repaired = repairTruncatedJson(cleaned);
    if (repaired) return repaired;

    return null;
  }

  return null;
}

/**
 * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
 * Handles LLM responses that got cut off by max_tokens limits.
 */
function repairTruncatedJson(text: string): string | null {
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;

  let json = text.slice(firstBrace);

  // Close any open string
  let inString = false;
  let escape = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') inString = !inString;
  }
  if (inString) json += '"';

  // Remove any trailing incomplete key-value pair (trailing comma + partial key)
  json = json.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, '');
  // Remove trailing comma
  json = json.replace(/,\s*$/, '');

  // Count and close open brackets
  let braceDepth = 0;
  let bracketDepth = 0;
  inString = false;
  escape = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
  }

  for (let i = 0; i < bracketDepth; i++) json += ']';
  for (let i = 0; i < braceDepth; i++) json += '}';

  try {
    JSON.parse(json);
    return json;
  } catch {
    return null;
  }
}

function findBalancedBraces(
  text: string,
  from: number,
): { text: string; start: number } | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        return { text: text.slice(start, i + 1), start };
      }
    }
  }

  return null;
}

/**
 * Single-retry helper: re-prompts the LLM with a nudge for valid JSON.
 * Returns the parsed result or null if still unparseable.
 */
export async function retryOnParseFail<T>(
  llm: OrchestratorLLM,
  systemPrompt: string,
  originalResponse: string,
  parseFn: (response: string) => T | null,
): Promise<T | null> {
  const nudge = `Your previous response was not valid JSON. Respond with ONLY a JSON object, no markdown, no text:\n\n${originalResponse.slice(0, 500)}`;
  const retryResponse = await llm.invokeJSON(systemPrompt, nudge);
  return parseFn(retryResponse);
}
