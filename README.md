# PrivatPenge – lokalt økonomi-dashboard

Et personligt økonomi-dashboard, der kører på din egen computer. Det giver overblik over konti, løn, faste udgifter,
forbrug, formue (bolig, depot, kunst m.m.), realkreditlån og backtest af porteføljer.

Der følger **ingen rigtige data** med. Første gang du åbner dashboardet, kan du trykke **Indlæs demodata** og se det hele
med en fiktiv person. Bagefter forbinder du din egen bank, og så bliver dine data på din egen computer.

## Kom i gang

Kræver [Node.js](https://nodejs.org) 20 eller nyere. Der skal ikke installeres andre pakker.

```bash
git clone <repo-url> min-oekonomi
cd min-oekonomi
cp .env.example .env
node server.js
```

Åbn http://localhost:5180. På Mac kan du også dobbeltklikke på `Start dashboard.command`.

## Hvor ligger dine data?

| Sti | Indhold |
|---|---|
| `data/db.json` | Posteringer, faste poster, formue, lån og porteføljer |
| `data/prices/` | Kursdata (cache) |
| `keys/` | Din private nøgle til Enable Banking |
| `.env` | Dit app-ID og din API-nøgle |

Alle fire står i `.gitignore` og kommer derfor aldrig med, hvis du laver ændringer og pusher til GitHub.
Serveren lytter kun på `127.0.0.1`, så andre på netværket kan ikke se dashboardet. Data forlader kun computeren
ved kald til din bank (via Enable Banking) og ved kursopslag hos Alpha Vantage.

## Forbind din bank (valgfrit)

Danske banker giver ikke privatpersoner direkte API-adgang. Adgangen går derfor gennem PSD2-tjenesten
[Enable Banking](https://enablebanking.com), som er gratis, når man kun forbinder sine egne konti.
**Hver person opretter sin egen applikation** – del aldrig din nøgle eller dit app-ID med andre.

1. Opret en konto på https://enablebanking.com og gå til **Control Panel → API applications**.
2. Opret en applikation i miljøet **Production** med redirect-URL `https://localhost:5180/api/eb/callback`.
3. Gem den private nøgle, du får, som `keys/enablebanking.pem`.
4. Indsæt app-ID'et i `.env` som `ENABLE_BANKING_APP_ID=` og ret `ENABLE_BANKING_REDIRECT_URL` til samme adresse som i trin 2.
5. Aktivér applikationen ved at linke dine egne konti i Enable Bankings kontrolpanel, og genstart dashboardet.
6. Gå til **Indstillinger → Forbind med MitID** og vælg din bank.

Efter MitID sender banken dig til `https://localhost…`, som browseren ikke kan åbne. Det er forventet:
kopiér adressen fra adresselinjen og indsæt den i feltet **"Kom du ikke automatisk tilbage?"** under Indstillinger.

Adgangen gælder op til 90 dage og skal derefter fornyes med MitID. Mens serveren kører, hentes nye posteringer
automatisk hver 6. time.

**Uden bankforbindelse:** eksportér posteringer som CSV fra netbanken og træk filen ind under **Indstillinger**.

**Nordnet** har intet offentligt API for privatkunder. Depotværdien registreres under **Formue**.

## Bolig & lån

Under **Formue** opretter du din bolig og under **Bolig & lån** dit realkreditlån (restgæld, rente, bidrag,
afdragsfrihed og udløb – tallene står på låneoversigten hos realkreditinstituttet). Fanen viser restgæld over tid,
hvornår betalingerne falder, boligens økonomi pr. måned inkl. lejeindtægt, og "hvad nu hvis"-scenarier
(ekstraordinært afdrag, afdrag nu, anden rente). Rentefradraget regnes med en fast sats, som du selv sætter.

## Portefølje-test

Kursdata hentes fra Alpha Vantage. Hent en gratis nøgle på https://www.alphavantage.co/support/#api-key
og sæt den i `.env` som `ALPHAVANTAGE_API_KEY=`. Den giver 25 opslag i døgnet, og kurser gemmes lokalt i 3 dage.

- Alle kurser omregnes til DKK med månedlige valutakurser.
- **Fast afkast** (`FAST:3` = 3 % p.a.) bruges til aktiver uden kurs, fx bolig og kunst.
- **Egne kursserier** kan uploades som CSV (`dato;kurs`), fx for danske investeringsforeninger.
- Skat og handelsomkostninger er ikke medregnet. Eksempelporteføljerne er lærebogseksempler, ikke anbefalinger.

## Filer

| Fil | Indhold |
|---|---|
| `server.js` | HTTP-server og API |
| `lib/enablebanking.js` | PSD2-klient (JWT/RS256) |
| `lib/csv.js` | Indlæsning af bank-CSV |
| `lib/categorize.js` | Kategorier, regler og genkendelse af faste poster |
| `lib/backtest.js` | Kursdata, valutaomregning og backtest |
| `lib/demo.js` | Fiktive demodata |
| `public/` | Brugerfladen |

Dashboardet er et overblik, ikke økonomisk eller skattemæssig rådgivning.
