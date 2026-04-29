"""Custom client example: using Ollama or Azure OpenAI."""

from openai import OpenAI
from simple_harness import Agent, tool

# --- Option 1: Local Ollama ---
client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="unused",  # Ollama doesn't need an API key
)

# --- Option 2: Azure OpenAI ---
# from openai import AzureOpenAI
# client = AzureOpenAI(
#     api_key="...",
#     api_version="2024-02-15-preview",
#     azure_endpoint="https://your-resource.openai.azure.com/",
# )


@tool
def greet(name: str) -> str:
    """Generate a greeting.

    Args:
        name: The person's name.
    """
    return f"Hello, {name}!"


agent = Agent(client=client, model="llama3", tools=[greet])
answer = agent.run("Greet Alice politely.")
print(answer)
