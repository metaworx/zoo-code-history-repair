# Agent Tool Reference

This file documents tool availability by runtime profile.

Runtime tags used in this document:
- `GPT-5.3-codex@Junie`: JetBrains Junie runtime tool surface.
- `GPT-5.3-codex@Codex`: Codex CLI/runtime tool surface.

Runtime contract precedence:
- If this document conflicts with runtime-exposed tools in the current session, the runtime contract is authoritative.

Response channels used by agent runtimes:
- `normal assistant response channel`: Plain user-visible assistant messages used for explanations, answers, plans, and
  summaries without invoking a dedicated project tool.
- `intermediary status/progress channel`: Short in-progress updates while work is being executed (runtime-dependent; may
  map to dedicated tools such as `update_status` or to assistant status messages).
- `final completion/submission channel`: The final completion handoff for a task/session (runtime-dependent; may map to
  dedicated tools such as `submit` or a normal final assistant response).

## Table of Contents

- [Runtime Availability Matrix](#runtime-availability-matrix)
- [User messages](#user-messages)
    - [`answer`](#answer)
    - [`update_status`](#update_status)
    - [`submit`](#submit)
    - [`ask_user`](#ask_user)
- [Edit and project tools](#edit-and-project-tools)
    - [`search_project`](#search_project)
    - [`get_file_structure`](#get_file_structure)
    - [`open`](#open)
    - [`open_entire_file`](#open_entire_file)
    - [`scroll_down` / `scroll_up`](#scroll_down--scroll_up)
    - [`apply_patch`](#apply_patch)
    - [`create`](#create)
    - [`search_replace`](#search_replace)
    - [`multi_edit`](#multi_edit)
    - [`rename_element`](#rename_element)
    - [`undo_edit`](#undo_edit)
    - [`lint`](#lint)
    - [`update_plan`](#update_plan)
    - [`view_image`](#view_image)
- [Command line tool](#command-line-tool)
    - [`bash` (PowerShell runtime)](#bash-powershell-runtime)
    - [`shell_command`](#shell_command)
- [Web tools](#web-tools)
    - [`web_search`](#web_search)
    - [`fetch_url`](#fetch_url)

## Runtime Availability Matrix

| Tool | GPT-5.3-codex@Junie | GPT-5.3-codex@Codex | Gemini 3 Flash@Junie |
| --- | --- | --- | --- |
| [`answer`](#answer) | ✅ Yes | ❌ No | ✅ Yes |
| [`update_status`](#update_status) | ✅ Yes | ❌ No | ✅ Yes |
| [`submit`](#submit) | ✅ Yes | ❌ No | ✅ Yes |
| [`ask_user`](#ask_user) | ✅ Yes | ❌ No | ✅ Yes |
| [`search_project`](#search_project) | ✅ Yes | ❌ No | ✅ Yes |
| [`get_file_structure`](#get_file_structure) | ✅ Yes | ❌ No | ✅ Yes |
| [`open`](#open) | ✅ Yes | ❌ No | ✅ Yes |
| [`open_entire_file`](#open_entire_file) | ✅ Yes | ❌ No | ✅ Yes |
| [`scroll_down` / `scroll_up`](#scroll_down--scroll_up) | ✅ Yes | ❌ No | ✅ Yes |
| [`apply_patch`](#apply_patch) | ✅ Yes | ✅ Yes | ✅ Yes |
| [`create`](#create) | ❌ No | ❌ No | ✅ Yes |
| [`search_replace`](#search_replace) | ❌ No | ❌ No | ✅ Yes |
| [`multi_edit`](#multi_edit) | ❌ No | ❌ No | ✅ Yes |
| [`rename_element`](#rename_element) | ✅ Yes | ❌ No | ✅ Yes |
| [`undo_edit`](#undo_edit) | ✅ Yes | ❌ No | ✅ Yes |
| [`lint`](#lint) | ✅ Yes | ❌ No | ✅ Yes |
| [`update_plan`](#update_plan) | ❌ No | ✅ Yes | ❌ No |
| [`view_image`](#view_image) | ❌ No | ✅ Yes | ❌ No |
| [`bash` (PowerShell runtime)](#bash-powershell-runtime) | ✅ Yes | ❌ No | ✅ Yes |
| [`shell_command`](#shell_command) | ❌ No | ✅ Yes | ❌ No |
| [`web_search`](#web_search) | ✅ Yes | ❌ No | ❌ No |
| [`fetch_url`](#fetch_url) | ✅ Yes | ❌ No | ❌ No |

## User messages

### `answer`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Send user-visible explanatory output (analysis, Q&A, plans, clarifications).
- Properties:
    - `full_answer` (string, Markdown): The complete response shown to the user.
    - Example `full_answer` value:
      ```markdown
      ### AP workflow v1.2: clarify commit gate fields
  
      #### Discussion
      - Answered your ASK about signal precedence and pause formatting.
  
      #### Updated Action Plan
      1. Patch `AGENTS.md` gate semantics and diagram.
      2. Add tool examples to `.aiassistant/TOOLS.md`.
      3. Re-check consistency and submit.
  
      #### Gate
      - Checkpoint: AP prepared and ready.
      - Overall Task: AP workflow v1.2: clarify commit gate fields.
      - Last Action: Drafted patch and validated requested scope.
      - Pending action: Apply documentation edits.
      - Proposed commit message: N/A.
      - Confirmation needed: EXEC/EXEC+/EXEC++/EXEC+++.
      ```
- Recent usage example:
    - Sent a structured response with sections `Applied patch status`, `User-visible message tools`, and
      `Confirmation needed...`.

### `update_status`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Send user-visible progress + plan status during multi-step `[CODE]`/`[SETUP]`/`[NICHE]` work.
- Properties:
    - `analysis` (string): Concise summary of critical progress since the last status update.
    - `plan` (string): Numbered plan with per-line status marks (`*`, `✓`, `!`, or empty).
    - Example `plan` string:
      ```text
      1. Update `AGENTS.md` gate rules ✓
      2. Extend `.aiassistant/TOOLS.md` examples ✓
      3. Verify wording consistency and submit *
      ```
- Recent usage example:
    - Published a plan checkpoint after AGENTS restructuring and marked completed/in-progress items.

### `submit`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Send final completion summary and terminate the session.
- Properties:
    - `solution_summary` (string, Markdown bullets):
        - `Summary`
        - `Changes`
        - `Verification`
        - `[Notes]`
    - `plan` (string, optional): Final status of existing plan items.
- Recent usage example:
    - Used earlier in session for a forced "current state" submission checkpoint.

### `ask_user`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Ask the user for clarification or guidance when blocked/ambiguous.
- Properties:
    - `message` (string): Concise explanation of blocker/question.

## Edit and project tools

### `search_project`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Search literal text/symbol/file-name fragments across the project.
- Properties:
    - `search_term` (string): Literal keyword or short phrase.
    - `path` (string, optional): Restrict search scope.

### `get_file_structure`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Show imports and symbol structure for a file.
- Properties:
    - `file` (string): Full file path.

### `open`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Open a 100-line window from a file.
- Properties:
    - `path` (string): Full file path.
    - `line_number` (number, optional): Start line for the window.

### `open_entire_file`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Show full file content when necessary.
- Properties:
    - `path` (string): Full file path.

### `scroll_down` / `scroll_up`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Move the current open-file window by 100 lines.
- Properties:
    - none.

### `apply_patch`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `GPT-5.3-codex@Codex`
    - `Gemini 3 Flash@Junie`
- Purpose: Add/update files via V4A patch blocks.
- Properties:
    - `patch` (string): Full patch block (`*** Begin Patch` ... `*** End Patch`).

### `create`

- Availability:
    - `Gemini 3 Flash@Junie`
- Properties:
    - `filename` (string): the full path to the file to create.
    - `content` (string): content of the new created file.

### `search_replace`

- Availability:
    - `Gemini 3 Flash@Junie`
- Properties:
    - `file_path` (string): The full path of the file that will be modified.
    - `search` (string): A continuous, yet concise block of lines to search for.
    - `replace` (string): The lines to replace the existing code found.
    - `replace_all` (boolean, optional): If true, replaces all occurrences.

### `multi_edit`

- Availability:
    - `Gemini 3 Flash@Junie`
- Properties:
    - `file_path` (string): The absolute path to the file to modify.
    - `edits` (array): An array of edit objects, each containing `search` and `replace` strings.

### `rename_element`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Safe symbol rename with automatic reference updates across codebase.
- Properties:
    - `file_path` (string)
    - `line_number` (number)
    - `element_to_rename` (string)
    - `new_element_name` (string)

### `undo_edit`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Revert the last project edit.
- Properties:
    - none.

### `lint`

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Analyze one file for syntax/semantic issues (and optional warnings).
- Properties:
    - `file` (string)
    - `include_warnings` (boolean, optional)

### `update_plan`

- Availability:
    - `GPT-5.3-codex@Codex`
- Purpose: Update task plan state with concise step statuses.
- Properties:
    - `plan` (array): Step list with `step` and `status`.
    - `explanation` (string, optional)

### `view_image`

- Availability:
    - `GPT-5.3-codex@Codex`
- Purpose: Inspect a local image by absolute file path.
- Properties:
    - `path` (string): Absolute local image path.

## Command line tool

### `bash` (PowerShell runtime)

- Availability:
    - `GPT-5.3-codex@Junie`
    - `Gemini 3 Flash@Junie`
- Purpose: Run non-interactive shell commands on the local machine.
- Properties:
    - `command` (string): Single PowerShell command invocation.
    - `timeout` (number): Execution timeout in seconds.
    - `background` (boolean, optional): Run as persistent background process.
- Recent usage example:
    - `git status --short` to verify modified files and gate readiness.

### `shell_command`

- Availability:
    - `GPT-5.3-codex@Codex`
- Purpose: Run non-interactive PowerShell commands in the workspace.

## Web tools

### `web_search`

- Availability:
    - `GPT-5.3-codex@Junie`
- Purpose: Search the web for current information.
- Properties:
    - `query` (string): Search query.

### `fetch_url`

- Availability:
    - `GPT-5.3-codex@Junie`
- Purpose: Fetch and extract content from a specific URL.
- Properties:
    - `url` (string): URL to fetch.
    - `extract_depth` (string, optional): `basic` or `advanced`.

### `web`

- Availability:
    - `GPT-5.3-codex@Codex`
- Purpose: Browse/search the web when online verification is required.