# PrivatPenge – local personal finance dashboard

A personal finance dashboard that runs on your own computer. It gives you an overview of your accounts, salary, fixed
expenses, spending, net worth (home, brokerage account, art etc.), mortgage, and lets you backtest investment portfolios.

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
| `data/db.json` | Transactions, fixed items, assets, loans and portfolios |
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

**Nordnet** has no public API for private customers. Enter the value of your account under **Formue** (net worth).

## Monthly summary

Below the spending chart on the front page there is a short summary of the month: where you ate, where you shopped,
purchases abroad and the biggest purchase. Click a category in the chart to see a summary of just that category.
The summary is written by the app itself from your transactions – no AI, no API key and nothing leaves your computer.

## Home & mortgage

Under **Formue** (net worth) you add your home, and under **Bolig & lån** (home & mortgage) you enter your mortgage:
outstanding balance, interest rate, contribution fee (bidrag), interest-only period and maturity. You can find these
figures in the loan overview from your mortgage lender. The tab shows the outstanding balance over time, when payments
fall due, the monthly economy of the home including rental income, and "what if" scenarios: extra repayment,
starting repayments now, or a different interest rate. The tax deduction is calculated with a flat rate that you set yourself.

## Portfolio test

Price data comes from Alpha Vantage. Get a free key at https://www.alphavantage.co/support/#api-key
and put it in `.env` as `ALPHAVANTAGE_API_KEY=`. The free key allows 25 lookups per day, and prices are cached locally for 3 days.

- All prices are converted to DKK using monthly exchange rates.
- **Fixed return** (`FAST:3` = 3 % per year) is used for assets without a market price, such as a home or art.
- **Custom price series** can be uploaded as CSV (`date;price`), e.g. for Danish investment funds.
- Taxes and trading costs are not included. The example portfolios are textbook examples, not recommendations.

## Files

| File | Contents |
|---|---|
| `server.js` | HTTP server and API |
| `lib/enablebanking.js` | PSD2 client (JWT/RS256) |
| `lib/csv.js` | Bank CSV import |
| `lib/categorize.js` | Categories, rules and detection of recurring items |
| `lib/backtest.js` | Price data, currency conversion and backtest |
| `lib/demo.js` | Fictional demo data |
| `public/` | User interface |

The dashboard is an overview tool, not financial or tax advice.
