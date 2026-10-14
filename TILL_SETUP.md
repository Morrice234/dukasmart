# Connecting a shop's M-Pesa till

When this is done:

- every payment customers make to the shop's till appears in the app's Sales by itself, usually within a minute;
- staff can send an M-Pesa prompt to a customer's phone from the sale screen or a deni customer's page, and the money goes straight to the till.

Safaricom only sends a till's payments to a Daraja app that belongs to that same till. So each shop takes its own till live once, and you put the keys into the admin panel. Do it with the owner, on a laptop, in about 15 minutes.

## What the owner needs

- A Lipa na M-Pesa till (Buy Goods) or paybill with access to the **M-Pesa business (organisation) portal**. Safaricom gives the business administrator login when the till is opened. If they never got one, they ask Safaricom business care for it.
- The phone number registered on the till, to receive the OTPs.

Pochi la Biashara has no portal or API. Those shops use **Account → M-Pesa payments → Add from M-Pesa messages** in the app instead.

## Steps

1. **In the M-Pesa business portal**, create an API user for the store number: *Operators → Add*. Give it the role for API access (the exact name varies; it mentions API, for example Business Manager or API initiator) and note the username and password. The store number (head office number) is shown on the portal home page and is not the same as the till number customers pay to.
2. **On developer.safaricom.co.ke**, log in with your own developer account and open **Go Live**.
   - Verification type: Shortcode. Enter the store number and the organisation name exactly as on the portal.
   - Enter the API username from step 1. Safaricom sends an OTP to the till's registered phone. The owner reads it to you.
   - Choose both products: **C2B** (payments recorded automatically) and **M-Pesa Express / Lipa Na M-Pesa Online** (payment prompts). When it finishes, a new live app appears under My Apps.
   - Safaricom then emails the **passkey** for M-Pesa Express to the till's registered email. Ask the owner to forward it to you.
3. Open that live app and copy its **Consumer Key** and **Consumer Secret**.
4. **In the DukaSmart admin panel**, open the business, scroll to **M-Pesa till** and fill in:
   - Environment: Live
   - Type: Till (Buy Goods), or Paybill if that is what they have
   - Store number or paybill: the store number from step 1
   - Till number: the number customers pay to (shown in the app)
   - Consumer key and secret from step 3
   - M-Pesa Express passkey from the email (you can add it later; prompts stay off until you do)

   Then click **Connect till**. The status should say Connected.
5. Ask the owner to pay KSh 10 to their till from any phone. Within a minute it shows under the till panel and in the app's Sales.
6. If you added the passkey, sign out and back in on the owner's phone (or wait for the app to refresh), make a KSh 10 sale and tap **Ask customer to pay by M-Pesa**. Their phone should show the PIN prompt.

## If something goes wrong

- **"Safaricom did not accept the consumer key and secret"**: the keys were copied from the sandbox app instead of the live one, or have a space in them.
- **"Already registered" or no payments arrive after the test**: the till was connected to another system before. Email apisupport@safaricom.co.ke from the owner's registered email asking them to delete the C2B URLs for the shortcode, then click Save and register again.
- **Payments show in the panel but not on the phone**: pull down on the M-Pesa payments screen, or wait for the next background sync (5 minutes).

## Testing without a real till

Pick Sandbox and Type Paybill. Use shortcode **174379**, your sandbox app's key and secret, and the public sandbox passkey `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`. Then:

- click **Send test payment** and click Refresh to test automatic recording (if 174379 is refused for C2B, use the C2B shortcode on your sandbox test credentials page);
- in the app, send a prompt to your own Safaricom number. Sandbox prompts reach real phones but no real money moves.

Sandbox needs a public https address for your server, so test against the Render server, not your laptop.

## Server settings

Add **TILL_ENCRYPTION_KEY** on Render (any long random string) before connecting the first shop, and never change it. If it changes, each till's keys must be entered again.
