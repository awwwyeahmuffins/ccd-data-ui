"""Lambda handler for Bedrock chat — receives messages, calls Bedrock Messages API."""

import json
import os
import boto3

bedrock = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("BEDROCK_REGION", "us-east-1"),
)
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")
ALLOWED_ORIGINS = set(
    os.environ.get(
        "ALLOWED_ORIGINS",
        "https://collincountyelections.com,https://www.collincountyelections.com,http://localhost:3000",
    ).split(",")
)
DEFAULT_ORIGIN = "https://collincountyelections.com"

# Cost guardrails: bound per-request Bedrock input/output
MAX_MESSAGES = 20
MAX_TOTAL_CHARS = 16000
MAX_OUTPUT_TOKENS = 512
VALID_ROLES = {"user", "assistant", "system"}


def handler(event, context):
    origin = (event.get("headers") or {}).get("origin", "")
    cors_origin = origin if origin in ALLOWED_ORIGINS else DEFAULT_ORIGIN

    def respond(status_code, body):
        return _response(status_code, body, cors_origin)

    try:
        try:
            body = json.loads(event.get("body") or "{}")
        except json.JSONDecodeError:
            return respond(400, {"error": "Invalid JSON body"})

        messages = body.get("messages", [])

        if not isinstance(messages, list) or not messages:
            return respond(400, {"error": "No messages provided"})
        if len(messages) > MAX_MESSAGES:
            return respond(400, {"error": f"Too many messages (max {MAX_MESSAGES})"})

        total_chars = 0
        for msg in messages:
            if not isinstance(msg, dict):
                return respond(400, {"error": "Each message must be an object"})
            if msg.get("role") not in VALID_ROLES:
                return respond(400, {"error": "Invalid message role"})
            if not isinstance(msg.get("content"), str):
                return respond(400, {"error": "Message content must be a string"})
            total_chars += len(msg["content"])
        if total_chars > MAX_TOTAL_CHARS:
            return respond(400, {"error": f"Messages too long (max {MAX_TOTAL_CHARS} characters total)"})

        # Separate system prompt from chat messages
        system_prompt = None
        chat_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_prompt = msg["content"]
            else:
                chat_messages.append({"role": msg["role"], "content": msg["content"]})

        if not chat_messages:
            return respond(400, {"error": "No user/assistant messages provided"})

        # Build Bedrock request
        bedrock_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": MAX_OUTPUT_TOKENS,
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

        return respond(200, {
            "message": {"role": "assistant", "content": assistant_text}
        })

    except Exception as e:
        # Log the real error to CloudWatch; never leak internals to the client
        print(f"Error: {e}")
        return respond(500, {"error": "Internal error"})


def _response(status_code, body, origin=DEFAULT_ORIGIN):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(body),
    }
