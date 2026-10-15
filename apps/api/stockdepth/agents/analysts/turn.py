"""One bounded research turn, with no tools offered on the final attempt."""
import json
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

WRAP_UP = ('Tool round budget exhausted. Write your final research report now using only the evidence already retrieved. '
           'Do not call tools. Explicitly identify unavailable data and uncertainty.')


def take_turn(prompt, llm, tools, messages):
    if messages and isinstance(messages[-1], HumanMessage) and messages[-1].content == WRAP_UP:
        written = []
        for message in messages:
            if isinstance(message, AIMessage) and message.tool_calls:
                written.append(AIMessage(content=f'{message.content}\n[Earlier tool requests: {json.dumps(message.tool_calls)}]'))
            elif isinstance(message, ToolMessage):
                written.append(HumanMessage(content=f'[Tool evidence: {message.name or "data"}]\n{message.content}'))
            else:
                written.append(message)
        return (prompt.partial(tool_names='none; report only') | llm).invoke(written)
    from stockdepth.agents.runtime_tools import analyst_tools
    return (prompt | llm.bind_tools(analyst_tools(tools))).invoke(messages)
