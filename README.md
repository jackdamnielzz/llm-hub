# LLM Hub

Eigen chat-app met meerdere LLM-providers, je eigen API-keys, webzoeken en artifacts.

## Starten

    npm install
    npm run dev        # http://localhost:3000

Voor productie: `npm run build && npm start`. Gebruik https (of localhost): de browser
versleutelt keys met WebCrypto, en die API is alleen beschikbaar in een secure context.

## Instellen

1. Open **Instellingen & API-keys**.
2. Plak je key bij de provider(s) die je wilt gebruiken. Pas modelnamen aan als ze veranderen.
3. Zet **Webzoeken** aan met een Brave Search API-key (brave.com/search/api).
4. Kies een model bovenin en begin te chatten.

## Hoe het werkt

- Keys worden versleuteld (AES-GCM) in localStorage opgeslagen; de sleutel staat in IndexedDB van deze browser.
- Per verzoek gaat de key naar `/api/chat`, dat het verzoek doorstuurt naar de provider. Er is geen database.
- Webzoeken: de server voert een tool-loop uit met `web_search` (Brave) en `fetch_url`.
- Artifacts: HTML, SVG en React-componenten in codeblokken openen in een sandboxed iframe.
- Projecten: instructies en tekst/afbeeldingbestanden worden bij elke chat in het project meegegeven.

## Bekende beperkingen

- Chats en projecten staan alleen in deze browser (geen sync, geen login).
- Geen PDF- of Word-bestanden (wel tekst en afbeeldingen).
- `fetch_url` haalt elke URL op via de server. Zet de app niet publiek open zonder SSRF-afscherming.
- Tijdens een webzoek-antwoord verschijnt de tekst in één keer, niet woord voor woord.
- Ollama werkt alleen als de server de lokale poort kan bereiken.
