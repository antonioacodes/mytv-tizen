# MyTV Tizen

Aplicativo Samsung TV da MyTV, construído como uma **Tizen Web Application**.

## Primeira entrega

- Splash com autenticação persistente por dispositivo;
- integração HTTPS com `auth.php` e `home.php`;
- Home com heróis rotativos, plataformas e cards editoriais;
- tokens visuais extraídos da referência Android: Outfit, superfícies escuras e foco ciano.

## Abrir no Tizen Studio

1. `File > Import > Tizen > Tizen Project`;
2. escolha a pasta deste repositório;
3. selecione o perfil `tv-samsung`;
4. vincule o perfil no Certificate Manager antes de gerar o `.wgt`.

## Contratos de backend usados

- `POST https://acodes.pro/mytv_backend/api/auth.php`
- `GET https://acodes.pro/mytv_backend/api/home.php`

O ID do dispositivo fica em `localStorage`. A implementação usa tentativas com timeout para que uma oscilação não deixe a Splash travada.
