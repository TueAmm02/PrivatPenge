# PrivatPenge – local personal finance dashboard

A personal finance dashboard that runs on your own computer. It gives you an overview of your accounts, salary, fixed
expenses, spending, net worth (home, brokerage account, art etc.), mortgage, and tracks your investment portfolio with up-to-date prices.

The app is built for Danish users, so the interface is in Danish. Button and menu names below are given in Danish
with an English explanation.

**No real data is included.** The first time you open the dashboard, click **Indlæs demodata** (load demo data) to
explore everything with a fictional person. Afterwards you connect your own bank, and your data stays on your own computer.

## Getting started

Requires [Node.js](https://nodejs.org) 20 or newer. No other packages need to be installed.

```bash
git clone https://github.com/TueAmm02/PrivatPenge.git
cd PrivatPenge
cp .env.example .env
node server.js
```

Open http://localhost:5180. On a Mac you can also double-click `Start dashboard.command`.

## Where is your data stored?

| Path | Contents |
|---|---|
| `data/db.json` | Transactions, fixed items, assets, loans and portfolio holdings |
| `data/prices/` | Price data (cache) |
| `keys/` | Your private key for Enable Banking |
| `.env` | Your app ID and API key |

All four are listed in `.gitignore`, so they are never included if you make changes and push to GitHub.
The server only listens on `127.0.0.1`, so other devices on your network cannot see the dashboard. Data only leaves
your computer when the app calls your bank (via Enable Banking) and when it looks up prices at Alpha Vantage.

## Connect your bank (optional)

Danish banks do not offer private individuals direct API access. Access therefore goes through the PSD2 service
[Enable Banking](https://enablebanking.com), which is free when you only connect your own accounts.
**Everyone creates their own application** – never share your key or app ID with anyone.

1. Create an account at https://enablebanking.com and go to **Control Panel → API applications**.
2. Create an application in the **Production** environment with the redirect URL `https://localhost:5180/api/eb/callback`.
3. Save the private key you receive as `keys/enablebanking.pem`.
4. Put the app ID in `.env` as `ENABLE_BANKING_APP_ID=` and set `ENABLE_BANKING_REDIRECT_URL` to the same address as in step 2.
5. Activate the application by linking your own accounts in the Enable Banking control panel, then restart the dashboard.
6. Go to **Indstillinger → Forbind med MitID** (Settings → Connect with MitID) and choose your bank.

After MitID, the bank sends you to `https://localhost…`, which the browser cannot open. This is expected:
copy the address from the address bar and paste it into the field **"Kom du ikke automatisk tilbage?"**
(didn't you return automatically?) under Settings.

Access is valid for up to 90 days and must then be renewed with MitID. While the server is running, new transactions
are fetched automatically every 6 hours.

**Without a bank connection:** export your transactions as CSV from your online bank and drag the file into **Indstillinger** (Settings).

**Nordnet** has no public API for private customers. Enter your holdings under **Portefølje** (portfolio) instead.

## Monthly summary

Below the spending chart on the front page there is a short summary of the month: where you ate, where you shopped,
purchases abroad and the biggest purchase – in a slightly teasing tone. Click a category in the chart to see a summary of just that category.
The summary is written by the app itself from your transactions – no AI, no API key and nothing leaves your computer.

## Subscriptions & alerts

**Abonnementer** (subscriptions) lists everything that is charged regularly: streaming, apps, fitness, memberships,
mobile, internet, utilities and insurance – with the price per month and per year. A charge becomes a subscription when
the same recipient has taken roughly the same amount at a fixed interval. New subscriptions and price increases are
highlighted, and subscriptions that have stopped are listed separately, so you can check that a cancellation went through.

You get an **alert** on the front page when:

- rent or another fixed income (from **Faste poster**) has not arrived a few days after it usually does,
- a bill has not been charged when it usually is,
- a new subscription shows up or one gets more expensive.

Alerts are also sent as a **Mac notification** and, optionally, by **email**. Turn them on and off and send a test under
**Indstillinger**. Email needs your own mail account in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`ALERT_EMAIL_TO`) – for Gmail use `smtp.gmail.com`, port 465 and an app password. The dashboard has to be running to send alerts.

## Home & mortgage

Under **Formue** (net worth) you add your home, and under **Bolig & lån** (home & mortgage) you enter your mortgage:
outstanding balance, interest rate, contribution fee (bidrag), interest-only period and maturity. You can find these
figures in the loan overview from your mortgage lender. The tab shows the outstanding balance over time, when payments
fall due, the monthly economy of the home including rental income, and "what if" scenarios: extra repayment,
starting repayments now, or a different interest rate. The tax deduction is calculated with a flat rate that you set yourself.

## Portfolio

Under **Portefølje** you enter what you own: name, quantity, what you paid in total, account (e.g. Aktiesparekonto)
and currency. The page shows the current value, return, allocation per holding and per account, and the value over time.
The portfolio value is included in your net worth under **Formue**.

- **Automatic prices:** give a holding a symbol from Alpha Vantage (e.g. `VT`, `VWCE.DEX`, `AAPL`) – the built-in search finds it.
  Get a free key at https://www.alphavantage.co/support/#api-key and put it in `.env` as `ALPHAVANTAGE_API_KEY=`.
  The free key allows 25 lookups per day, so prices and exchange rates are cached for 12 hours and refreshed automatically.
- **Your own price:** Danish investment funds are rarely available at Alpha Vantage. Leave the symbol empty and type the price
  yourself (no key needed) – update it whenever you like.
- Foreign prices are converted to DKK with the latest exchange rate. One measurement per day is saved for the history chart.

## Files

| File | Contents |
|---|---|
| `server.js` | HTTP server and API |
| `lib/enablebanking.js` | PSD2 client (JWT/RS256) |
| `lib/csv.js` | Bank CSV import |
| `lib/categorize.js` | Categories, rules and detection of recurring items |
| `lib/prices.js` | Prices and exchange rates from Alpha Vantage |
| `lib/alerts.js` | Subscription detection and alerts |
| `lib/notify.js` | Mac notifications and email (small built-in SMTP client) |
| `lib/demo.js` | Fictional demo data |
| `public/` | User interface |

The dashboard is an overview tool, not financial or tax advice.
