"""Simple Harness: A minimal AI agent framework with ReAct tool-calling loop."""

from __future__ import annotations

import inspect
import json
import re
import typing
from typing import Any, Callable


# ---------------------------------------------------------------------------
# Schema generation from type hints
# ---------------------------------------------------------------------------

def _python_type_to_json_schema(py_type: Any) -> dict[str, Any]:
    """Map a Python type annotation to a JSON Schema dict."""
    origin = typing.get_origin(py_type)

    # Handle Optional[T] -> union with null
    if origin is typing.Union:
        args = typing.get_args(py_type)
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1 and type(None) in args:
            schema = _python_type_to_json_schema(non_none[0])
            return {**schema}
        # General Union — pick first non-None type
        return _python_type_to_json_schema(non_none[0]) if non_none else {}

    # Handle list[T]
    if origin is list:
        args = typing.get_args(py_type)
        schema: dict[str, Any] = {"type": "array"}
        if args:
            schema["items"] = _python_type_to_json_schema(args[0])
        return schema

    # Handle dict[K, V]
    if origin is dict:
        return {"type": "object"}

    type_map: dict[type, str] = {
        str: "string",
        int: "integer",
        float: "number",
        bool: "boolean",
    }
    json_type = type_map.get(py_type)
    if json_type:
        return {"type": json_type}

    # Fallback
    return {"type": "string"}


def _parse_docstring_args(docstring: str | None) -> dict[str, str]:
    """Parse the Args: section of a docstring into {param_name: description}."""
    if not docstring:
        return {}
    match = re.search(r"Args:\s*\n((?:\s+\w+.*\n?)+)", docstring)
    if not match:
        return {}
    args_text = match.group(1)
    result: dict[str, str] = {}
    for line in args_text.strip().splitlines():
        # Match "    name: description" or "    name (type): description"
        m = re.match(r"\s*(\w+)(?:\s*\([^)]*\))?\s*:\s*(.*)", line)
        if m:
            result[m.group(1)] = m.group(2).strip()
    return result


def _build_parameters_schema(fn: Callable) -> tuple[dict, str]:
    """Build JSON Schema from function signature + type hints.

    Returns (parameters_schema, description).
    """
    sig = inspect.signature(fn)
    hints = typing.get_type_hints(fn)
    docstring = inspect.getdoc(fn)
    arg_docs = _parse_docstring_args(docstring)

    # First line of docstring is the description
    description = ""
    if docstring:
        first_line = docstring.strip().splitlines()[0].strip()
        description = first_line

    properties: dict[str, Any] = {}
    required: list[str] = []

    for name, param in sig.parameters.items():
        if name == "self":
            continue

        prop = _python_type_to_json_schema(hints.get(name, str))

        if name in arg_docs:
            prop["description"] = arg_docs[name]

        if param.default is inspect.Parameter.empty:
            required.append(name)
        else:
            prop["default"] = param.default

        properties[name] = prop

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required

    return schema, description


# ---------------------------------------------------------------------------
# Tool
# ---------------------------------------------------------------------------

class Tool:
    """A tool that can be used by an agent."""

    def __init__(
        self,
        fn: Callable,
        name: str | None = None,
        description: str | None = None,
        parameters: dict | None = None,
    ) -> None:
        self.fn = fn
        schema, auto_desc = _build_parameters_schema(fn)
        self.name = name or fn.__name__
        self.description = description or auto_desc
        self.parameters = parameters or schema

    def __call__(self, **kwargs: Any) -> str:
        result = self.fn(**kwargs)
        return str(result)

    def to_openai_schema(self) -> dict[str, Any]:
        """Return the OpenAI tool definition dict."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


def tool(
    fn: Callable | None = None,
    *,
    name: str | None = None,
    description: str | None = None,
) -> Tool | Callable[[Callable], Tool]:
    """Decorator that converts a function into a Tool instance.

    Can be used as @tool or @tool(name="custom_name").
    """
    def decorator(fn: Callable) -> Tool:
        return Tool(fn, name=name, description=description)

    if fn is not None:
        # Used as @tool without arguments
        return Tool(fn)
    # Used as @tool(name=...) with arguments
    return decorator


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class Agent:
    """A ReAct-style agent that uses tool calling in a loop."""

    def __init__(
        self,
        client: Any,  # openai.OpenAI or compatible
        model: str = "gpt-4o",
        tools: list[Tool] | None = None,
        system_prompt: str | None = None,
        max_iterations: int = 20,
    ) -> None:
        self.client = client
        self.model = model
        self.max_iterations = max_iterations
        self.system_prompt = system_prompt

        self._tools: dict[str, Tool] = {}
        self._messages: list[dict[str, Any]] = []

        for t in (tools or []):
            self.add_tool(t)

    def add_tool(self, t: Tool) -> None:
        """Register a tool."""
        self._tools[t.name] = t

    def reset(self) -> None:
        """Clear conversation history (keeps tools and config)."""
        self._messages.clear()

    @property
    def messages(self) -> list[dict[str, Any]]:
        """Read-only view of conversation history."""
        return list(self._messages)

    def run(self, prompt: str) -> str:
        """Execute the ReAct loop. Returns the final answer text."""
        self._messages.append({"role": "user", "content": prompt})

        # Build tool schemas once (tools don't change during a run)
        tool_schemas = [t.to_openai_schema() for t in self._tools.values()]
        has_tools = len(tool_schemas) > 0

        for _ in range(self.max_iterations):
            # Build the message list for this API call
            api_messages: list[dict[str, Any]] = []
            if self.system_prompt:
                api_messages.append({"role": "system", "content": self.system_prompt})
            api_messages.extend(self._messages)

            # Call the LLM
            kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": api_messages,
            }
            if has_tools:
                kwargs["tools"] = tool_schemas

            response = self.client.chat.completions.create(**kwargs)
            assistant_message = response.choices[0].message

            # Convert to dict and store
            msg: dict[str, Any] = {"role": "assistant"}
            if assistant_message.content:
                msg["content"] = assistant_message.content
            else:
                msg["content"] = None
            if assistant_message.tool_calls:
                msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in assistant_message.tool_calls
                ]
            self._messages.append(msg)

            # No tool calls -> final answer
            if not assistant_message.tool_calls:
                return assistant_message.content or ""

            # Execute each tool call
            for tc in assistant_message.tool_calls:
                tool_name = tc.function.name
                tool_fn = self._tools.get(tool_name)

                if tool_fn is None:
                    result = f"Error: Unknown tool '{tool_name}'"
                else:
                    try:
                        args = json.loads(tc.function.arguments)
                        result = tool_fn(**args)
                    except json.JSONDecodeError:
                        result = f"Error: Invalid arguments for {tool_name}"
                    except Exception as e:
                        result = f"Error executing {tool_name}: {e}"

                self._messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

        # Max iterations reached
        last = self._messages[-1]
        return last.get("content", "") or "Agent reached maximum iterations without a final answer."
