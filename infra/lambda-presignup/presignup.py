# presignup.py
# ---------------------------------------------------------------------------
# Cognito Pre-Sign-up trigger.
#
# TEMPORARY: auto-confirms every new sign-up so users skip the email
# verification-code step entirely. To re-enable verification, remove the
# preSignUp trigger wiring in infra/lib/ccd-auth-chat-stack.ts and redeploy
# (this function can stay; it just won't be invoked).
def handler(event, context):
    event["response"]["autoConfirmUser"] = True
    attrs = event.get("request", {}).get("userAttributes", {})
    if "email" in attrs:
        event["response"]["autoVerifyEmail"] = True
    if "phone_number" in attrs:
        event["response"]["autoVerifyPhone"] = True
    return event
