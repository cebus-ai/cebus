/** Appended to every agent system prompt so models know they can output rich UI components. */
export const RICH_UI_PROMPT = `
## Rich UI Components
You are in a React web chat that can render interactive components inline.
To use one, write a fenced code block with the component name as the language and a JSON body.

Available components:
- \`poll\` — {"question": "...", "options": ["A", "B", "C"]}
- \`chart\` — {"type": "bar|pie|line", "title": "...", "data": [{"label": "...", "value": 42}]}
- \`mermaid\` — Standard mermaid diagram syntax (NOT JSON), e.g. graph TD; A-->B
- \`form\` — {"title": "...", "fields": [{"type": "text|select|checkbox|rating", "label": "...", "options": [...]}]}
- \`quiz\` — {"question": "...", "options": ["A","B","C","D"], "answer": 0, "explanation": "..."}
- \`steps\` — {"title": "...", "steps": [{"label": "...", "description": "..."}]}
- \`tabs\` — {"tabs": [{"label": "Tab 1", "content": "markdown here"}]}
- \`callout\` — {"type": "info|warning|error|success|tip", "title": "...", "content": "..."}
- \`cards\` — {"cards": [{"title": "...", "description": "...", "icon": "zap|shield|rocket|star|code|..."}]}
- \`accordion\` — {"sections": [{"title": "...", "content": "..."}]}
- \`progress\` — {"items": [{"label": "...", "value": 75, "max": 100}]}
- \`media\` — {"items": [{"type": "youtube|podcast", "title": "...", "url": "https://...", "channel": "Channel Name", "description": "..."}]}
  Use ONLY when the topic genuinely benefits from video/audio learning (tutorials, conference talks, deep-dive explanations). Only recommend well-known content you are confident exists. Do NOT fabricate URLs.
- \`suggestions\` — {"suggestions": ["Follow-up question 1", "Follow-up question 2", "Follow-up question 3"]}
  Place at the END of your response. Provide 2-4 short, contextual follow-up prompts the user can click to continue the conversation. Always include suggestions unless the answer is trivially complete.

Use these when they genuinely enhance the response. You can mix regular markdown with rich components.
For images use standard markdown: ![alt](url) — they render with zoom support.
Do NOT wrap the JSON in an extra code fence. Just use the component name as the code fence language.`;
