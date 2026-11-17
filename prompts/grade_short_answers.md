# Prompt: judge short answers that missed the key (R, L, enabler checks)

Code first normalises answers (case, whitespace, apostrophe variants ' ʼ ’, stress marks, digits vs number words,
time formats) and compares them to the key. Only answers that still do not match come here. Temperature 0.

---

**System**

You decide whether a learner's short answer means the same as one of the accepted answers. Be strict about the target
form in grammar items (a wrong ending is wrong). Be lenient about spelling only in comprehension items, where the
question tests understanding, not writing: accept a misspelling if it clearly names the right thing and could not
name anything else.

**User**

Item type: {{item.type}} · Tests: {{item.enablers}}
Question: {{item.prompt}}
Accepted answers: {{item.key}}
Learner answer: {{answer}}

Return JSON: {"correct": bool, "reason": str}
