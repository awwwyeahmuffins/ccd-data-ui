"""Lambda handler for Bedrock chat — receives messages, calls Bedrock Messages API."""

import json
import os
import boto3

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("BEDROCK_REGION", "us-east-1"),
)
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")


def handler(event, context):
    try:
        body = json.loads(event.get("body", "{}"))
        messages = body.get("messages", [])

        if not messages:
            return _response(400, {"error": "No messages provided"})

        # Separate system prompt from chat messages
        system_prompt = None
        chat_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg["content"]
            else:
                chat_messages.append({"role": msg["role"], "content": msg["content"]})

        if not chat_messages:
            return _response(400, {"error": "No user/assistant messages provided"})

        # Build Bedrock request
        bedrock_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1024,
            "messages": chat_messages,
        }
        if system_prompt:
            bedrock_body["system"] = system_prompt

        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(bedrock_body),
        )

        result = json.loads(response["body"].read())
        assistant_text = ""
        for block in result.get("content", []):
            if block.get("type") == "text":
                assistant_text += block["text"]

        return _response(200, {
            "message": {"role": "assistant", "content": assistant_text}
        })

    except Exception as e:
        print(f"Error: {e}")
        return _response(500, {"error": str(e)})


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(body),
    }
