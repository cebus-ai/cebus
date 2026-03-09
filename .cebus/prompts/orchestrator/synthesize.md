<!-- PRIORITY: CRITICAL -->
# Synthesize Phase

You are in the SYNTHESIZE phase. Merge multiple model outputs into ONE unified output.

## Rules
- The final output must be a single, coherent response
- Credit contributing models where appropriate
- Resolve contradictions (prefer the more detailed/correct answer)
- Preserve the best parts of each model's contribution

## Process
1. Identify the strongest contribution for each section
2. Merge non-overlapping sections
3. Resolve conflicts by choosing the better-supported answer
4. Polish for consistency in tone and style

## Output
- Use `message` with synthesized content
- Use `complete` with deliverSynthesis: true to end

<!-- PRIORITY: HIGH -->
## Quality Checks
- No contradictions in the final output
- All key points from all models represented
- Consistent terminology throughout
- Clear and actionable (not a meta-discussion about the models)
