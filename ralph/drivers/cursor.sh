#!/bin/bash
# Cursor CLI driver for Ralph (EXPERIMENTAL)
# Provides platform-specific CLI invocation logic for Cursor CLI.
#
# Known limitations:
# - CLI is in beta — binary name and flags may change
# - NDJSON stream format assumes {type: "text", content: "..."} events
# - Session ID capture from output not yet validated

driver_name() {
    echo "cursor"
}

driver_display_name() {
    echo "Cursor CLI"
}

driver_cli_binary() {
    local binary
    binary=$(driver_resolve_cli_binary)

    if [[ -n "$binary" ]]; then
        echo "$binary"
        return 0
    fi

    echo "cursor-agent"
}

driver_min_version() {
    echo "0.1.0"
}

driver_check_available() {
    local cli_binary
    cli_binary=$(driver_cli_binary)

    if [[ -f "$cli_binary" ]]; then
        return 0
    fi

    command -v "$cli_binary" &>/dev/null
}

# Cursor CLI tool names
driver_valid_tools() {
    VALID_TOOL_PATTERNS=(
        "file_edit"
        "file_read"
        "file_write"
        "terminal"
        "search"
    )
}

# Build Cursor CLI command
# Context is prepended to the prompt (same pattern as Codex/Copilot drivers).
# Uses --print for headless mode, --force for autonomous execution,
# --output-format stream-json for NDJSON streaming.
driver_build_command() {
    local prompt_file=$1
    local loop_context=$2
    local session_id=$3
    local cli_binary
    cli_binary=$(driver_cli_binary)

    if [[ ! -f "$prompt_file" ]]; then
        echo "ERROR: Prompt file not found: $prompt_file" >&2
        return 1
    fi

    CLAUDE_CMD_ARGS=()
    if [[ "$cli_binary" == *.cmd ]]; then
        CLAUDE_CMD_ARGS+=("$(driver_wrapper_path)" "$cli_binary")
    else
        CLAUDE_CMD_ARGS+=("$cli_binary")
    fi

    # Headless mode
    CLAUDE_CMD_ARGS+=("--print")

    # Autonomous execution
    CLAUDE_CMD_ARGS+=("--force")

    # NDJSON streaming output
    CLAUDE_CMD_ARGS+=("--output-format" "stream-json")

    # Session resume — gated on CLAUDE_USE_CONTINUE to respect --no-continue flag
    if [[ "$CLAUDE_USE_CONTINUE" == "true" && -n "$session_id" ]]; then
        CLAUDE_CMD_ARGS+=("--resume" "$session_id")
    fi

    # Build prompt with context prepended
    local prompt_content
    if driver_running_on_windows; then
        prompt_content=$(driver_build_windows_bootstrap_prompt "$loop_context" "$prompt_file")
    else
        prompt_content=$(cat "$prompt_file")
        if [[ -n "$loop_context" ]]; then
            prompt_content="$loop_context

$prompt_content"
        fi
    fi

    CLAUDE_CMD_ARGS+=("$prompt_content")
}

driver_supports_sessions() {
    return 0  # true — Cursor supports --resume
}

# Cursor CLI outputs NDJSON events
driver_stream_filter() {
    echo 'select(.type == "text") | .content // empty'
}

driver_running_on_windows() {
    [[ "${OS:-}" == "Windows_NT" || "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == win32* ]]
}

driver_resolve_cli_binary() {
    local candidate
    local resolved
    local fallback
    local candidates=(
        "cursor-agent"
        "cursor-agent.cmd"
        "agent"
        "agent.cmd"
    )

    for candidate in "${candidates[@]}"; do
        resolved=$(driver_lookup_cli_candidate "$candidate")
        if [[ -n "$resolved" ]]; then
            echo "$resolved"
            return 0
        fi
    done

    fallback=$(driver_localappdata_cli_binary)
    if [[ -n "$fallback" ]]; then
        echo "$fallback"
        return 0
    fi

    echo ""
}

driver_lookup_cli_candidate() {
    local candidate=$1
    local resolved

    resolved=$(command -v "$candidate" 2>/dev/null || true)
    if [[ -n "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    if ! driver_running_on_windows; then
        return 0
    fi

    driver_find_windows_path_candidate "$candidate"
}

driver_find_windows_path_candidate() {
    local candidate=$1
    local path_entry
    local normalized_entry
    local resolved_candidate
    local path_entries="${PATH:-}"
    local -a path_parts=()

    if [[ "$path_entries" == *";"* ]]; then
        IFS=';' read -r -a path_parts <<< "$path_entries"
    else
        IFS=':' read -r -a path_parts <<< "$path_entries"
    fi

    for path_entry in "${path_parts[@]}"; do
        [[ -z "$path_entry" ]] && continue

        normalized_entry=$path_entry
        if command -v cygpath &>/dev/null && [[ "$normalized_entry" =~ ^[A-Za-z]:\\ ]]; then
            normalized_entry=$(cygpath -u "$normalized_entry")
        fi

        resolved_candidate="$normalized_entry/$candidate"
        if [[ -f "$resolved_candidate" ]]; then
            echo "$resolved_candidate"
            return 0
        fi
    done
}

driver_localappdata_cli_binary() {
    local local_app_data="${LOCALAPPDATA:-}"

    if [[ -z "$local_app_data" ]] || ! driver_running_on_windows; then
        return 0
    fi

    if command -v cygpath &>/dev/null && [[ "$local_app_data" =~ ^[A-Za-z]:\\ ]]; then
        local_app_data=$(cygpath -u "$local_app_data")
    fi

    local candidate="$local_app_data/cursor-agent/agent.cmd"
    if [[ -f "$candidate" ]]; then
        echo "$candidate"
    fi
}

driver_wrapper_path() {
    local driver_dir
    driver_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    echo "$driver_dir/cursor-agent-wrapper.sh"
}

driver_build_windows_bootstrap_prompt() {
    local loop_context=$1
    local prompt_file=$2

    cat <<EOF
Read these Ralph workspace files before taking action:
- .ralph/PROMPT.md
- .ralph/PROJECT_CONTEXT.md
- .ralph/SPECS_INDEX.md
- .ralph/@fix_plan.md
- .ralph/@AGENT.md
- relevant files under .ralph/specs/

Then follow the Ralph instructions from those files and continue the next task.
EOF

    if [[ -n "$loop_context" ]]; then
        cat <<EOF

Current loop context:
$loop_context
EOF
    fi

    if [[ "$prompt_file" != ".ralph/PROMPT.md" ]]; then
        cat <<EOF

Also read the active prompt file if it differs:
- $prompt_file
EOF
    fi
}
