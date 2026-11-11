# Nova live local demo

Open http://127.0.0.1:4192/ on the running Mac. The model is real, local Ollama; responses are not scripted. Screen-share this window for today's users.

1. Add the current offer and policies under Business context. Only select the customer-sharing checkbox for information suitable for leads.
2. Import selected past conversations as text with sharing unchecked. Avoid unnecessary personal data. Existing WhatsApp history is not automatically accessible to a new bot.
3. Click Learn my business, then Send. Nova saves an operating brief privately.
4. Click Test an inbound lead, then Send. Continue the test lead's conversation. Nova replies automatically in this simulated channel and records the lead; it does not send WhatsApp messages.
5. Click Write an SEO article, edit the topic if needed, then Send. Download the resulting draft.

After sharing customer-safe package information, type or say “Follow up after four hours.” Nova saves the timing for new inquiries. Ask “Follow-up status” to see the setting, or say “Follow up after eight hours” to update it. This local preview demonstrates setup. Live delivery uses the connected messaging provider and the business's existing send permissions.

Use Send voice note to upload a recording under 5 MB and 3 minutes. Transcription and reasoning run locally.

Click Run SEO daily and Send to start recurring work, with the first result produced immediately by the background worker. LIST TASKS shows the saved jobs; STOP TASK followed by its ID stops one.

No approval is needed to produce work. The actual operator can run configured messaging, scheduling and integrations in automatic mode. Say WORK AUTOMATICALLY as an authenticated owner to enable that mode, PAUSE to stop, and REPORT for recorded activity. Real sends require connected providers. Published articles, sales and revenue are never inferred from a generated draft.

The website remains https://nova-evolution-v4.vercel.app. Its sample conversation is separate from this real local demo. WhatsApp test activation is pending Meta account review. Native WhatsApp calls and automatic historical chat access are not implemented by this demo. Public Cloudflare callback provisioning is timing out; this local demo is independent of that service.

## Caliph Travels paid pilot

Once live checkout and Meta are configured, start with one U.S. Umrah package and a customer-facing inbox separate from the Nova owner number.

1. The owner pays through checkout. A verified payment provisions the owner chat and queues the approved welcome template.
2. In the owner chat, describe the business and the first job by text or voice note. Share current package details for customer use and keep past quotes private unless explicitly needed. Reply DONE.
3. Caliph grants Meta access to the business inbox. An Evolution operator runs `python nova.py bind-inbox BUSINESS META_PHONE_ID` with the installed provider configuration. The command checks that the token can read the Meta asset before binding. The owner can check INBOX STATUS, optionally CONNECT CALENDAR, then reply DONE.
4. Choose automatic replies and follow-ups or review every action. Send a sample inquiry and reply ACTIVATE after reviewing Nova's practice answer. Say “Follow up after four hours.”
5. Use an opted-in tester to verify delivery and suppression after a reply before routing real inquiries. Staff confirm final prices and bookings during the pilot. Ask REPORT to see recorded work.

Meta asset access alone does not verify incoming webhooks or outbound delivery. Native WhatsApp calls and direct self-service Meta authorization are outside this implementation.
