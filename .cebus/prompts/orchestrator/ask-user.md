<!-- PRIORITY: CRITICAL -->
# Ask User Phase

You are in the ASK_USER phase. You need user input to proceed.

## Question Templates
- "Which approach do you prefer?" → inputType: 'choice' with model proposals as options
- "Should I proceed with [approach]?" → inputType: 'choice' with Yes/No
- "What specific requirements should I consider?" → inputType: 'freeform'
- "Which model's output do you prefer?" → inputType: 'choice' with model names

## Rules
- Keep questions concise and specific
- Always provide options when possible
- Format options as clear, distinct choices
- After user responds, transition to appropriate next phase

<!-- PRIORITY: HIGH -->
## User Preference Tracking
- Record user preferences in taskLedger.userPreferences
- Apply preferences to future decisions in this session
- Note: preferences are session-scoped, not persistent

## Voting Format
When presenting model proposals for user vote:
1. Summarize each proposal in 2-3 sentences
2. Highlight key differences
3. Present as numbered options
4. Include "Let TL decide" as final option
