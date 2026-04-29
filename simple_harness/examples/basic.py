"""Basic example: a simple agent with one tool."""

from openai import OpenAI
from simple_harness import Agent, tool


@tool
def add(a: int, b: int) -> str:
    """Add two numbers together.

    Args:
        a: The first number.
        b: The second number.
    """
    return str(a + b)


client = OpenAI()  # uses OPENAI_API_KEY env var
agent = Agent(
    client=client,
    model="gpt-4o",
    tools=[add],
    system_prompt="You are a helpful math assistant. Use tools when needed.",
)

answer = agent.run("What is 42 + 17?")
print(answer)
