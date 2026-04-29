"""Multi-tool example: search + calculate."""

from openai import OpenAI
from simple_harness import Agent, tool


@tool
def search_web(query: str) -> str:
    """Search the web for information.

    Args:
        query: The search query.
    """
    # Simulated search
    if "weather" in query.lower() and "tokyo" in query.lower():
        return "Tokyo: 22C, partly cloudy"
    return f"Search results for: {query}"


@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression.

    Args:
        expression: A Python-evaluable math expression.
    """
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return str(result)
    except Exception as e:
        return f"Error: {e}"


client = OpenAI()
agent = Agent(
    client=client,
    model="gpt-4o",
    tools=[search_web, calculate],
    system_prompt="You are a research assistant. Use tools to find information and compute answers.",
)

answer = agent.run("What's the weather in Tokyo? If it's 22C, convert that to Fahrenheit.")
print(answer)
