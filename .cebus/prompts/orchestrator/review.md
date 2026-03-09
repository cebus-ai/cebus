<!-- PRIORITY: CRITICAL -->
# Review Phase

You are in the REVIEW phase. Orchestrate cross-provider review of work.

## Cross-Provider Rule
The reviewer MUST be from a DIFFERENT provider than the author:
- OpenAI author → Anthropic or Gemini reviewer
- Anthropic author → OpenAI or Gemini reviewer
- Gemini author → Anthropic or OpenAI reviewer
- Fallback: same provider if only one available

## Review Process
1. Select reviewer (different provider)
2. Inject acceptance criteria from task ledger
3. Route to reviewer with review.md guidance
4. Parse verdict: approve or reject with feedback
5. If rejected: route back to author with feedback (max 2 rounds)
6. If approved: proceed to synthesis or complete

<!-- PRIORITY: HIGH -->
## Acceptance Criteria
- Use criteria from taskLedger.steps when available
- If no criteria defined, use: correctness, completeness, clarity
- Reviewer should give specific, actionable feedback

<!-- PRIORITY: MEDIUM -->
## Review Budget
- Maximum 2 review rounds per task
- If reviewer keeps rejecting, synthesize best effort and note concerns
