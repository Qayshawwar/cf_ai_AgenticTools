# Prompts

- I have an existing repository based on Cloudflare’s agents-starter template.

Please make minimal changes to turn it into a simple AI chat application with two built-in capabilities:
1. Job finder
2. Research assistant

Project requirements:
- Keep the existing Cloudflare agents-starter structure and UI as much as possible.
- Keep the app minimal and demo-focused.
- Use text chat only.
- Use Workers AI as the LLM already supported by the template.
- Use the existing Workers / Durable Object style of state handling from the template.
- Memory should be per conversation only.
- Do not add voice support.
- Do not add authentication.
- Do not add a database.
- Do not redesign the UI.
- Do not introduce unnecessary libraries or abstractions.

Desired behavior:
- The app should remain a single chat interface.
- The assistant should briefly mention near the start of a conversation that it can help with job finding and academic research.
- The user should be able to ask for either capability at any point in the same conversation.
- The assistant should decide when to use the job finder or research tool based on the user’s message.
- The user should not have to manually switch modes.

Tool 1: Job Finder
Goal:
- Help find relevant jobs based on user requests.

Implementation guidance:
- Prefer the simplest reliable implementation.
- If feasible with minimal code, use public job posting sources such as Greenhouse, Lever, and Ashby.
- If that is too complex, use one simpler source instead.
- Keep the implementation small and easy to understand.

Expected output:
- Return a short list of relevant jobs.
- Each result should include, when available:
  - title
  - company
  - location
  - source
  - link

Tool 2: Research Assistant
Goal:
- Help find academic papers or scholarly works related to a topic.

Implementation guidance:
- Use OpenAlex as the research source.
- Read the API key from an environment variable if needed.
- Keep the implementation focused on simple search and summarized results.

Expected output:
- Return a short list of relevant papers or works.
- Each result should include, when available:
  - title
  - authors
  - year
  - source or venue
  - URL
- The assistant should use the retrieved results to provide a helpful conversational response.

Prompt / assistant behavior:
- Update the assistant’s instructions so it is focused on these two capabilities while still being generally conversational.
- It should prefer tool usage when appropriate.
- It should avoid inventing tool results.
- It should ask a short follow-up question only when necessary.
- Keep responses concise and useful.

Error handling:
- Add simple graceful handling for missing API keys, network failures, or no results found.
- If a tool cannot run, the assistant should explain that briefly and continue helpfully.

Files:
- Inspect the existing repository structure first.
- Adapt to the current project instead of assuming a fresh starter.
- Prefer small targeted edits over large refactors.
- Keep code readable and simple.

README:
Please update the README so it clearly explains:
- what the project does
- the two supported capabilities
- the high-level architecture
- setup instructions
- required environment variables
- how to run locally
- how to test both capabilities from the chat UI
- known limitations
- how to deploy

The README should include example prompts for:
- job finding
- research queries

Environment variables:
Only add environment variables that are actually used.
For example:
- OPENALEX_API_KEY

Please keep the implementation lightweight, preserve the existing starter app where possible, and avoid unnecessary changes.