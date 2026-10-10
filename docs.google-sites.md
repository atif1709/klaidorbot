In the authenticated workspace, use the **Embed on another website** snippet under **Share your chatbot**. Add it to an HTML embed in Google Sites. The public chatbot URL works without visitor accounts; anyone with the link can ask questions answered from all FAQs in that account's workspace.

The backend must be publicly reachable over HTTPS. Its `EMBED_ANCESTORS` setting must allow the Google Sites host and any custom domain used by the site. The default allows `sites.google.com` and Google Sites' `googleusercontent.com` frames. For example:

```text
EMBED_ANCESTORS=https://sites.google.com https://*.googleusercontent.com https://www.example.com
```

The chatbot returns only a matching FAQ answer and source question, and public question requests are rate-limited. Do not put private, personal, or confidential information in FAQs that you do not want visitors to see.
