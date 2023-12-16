# DamonJs-Spotify

## A spotify plugin for DamonJs module

## Accepted query

- [x] Track link; `https://open.spotify.com/track/7nw4ElerVAP5235FN5D2OI`  
- [x] Playlist link; `https://open.spotify.com/playlist/2gzszlY4WeJOTOUU6x3sgA`  
- [x] Album link; `https://open.spotify.com/album/18UoCkfQKlMVnAcZXbiBz8`  
- [x] Artist link; `https://open.spotify.com/artist/64tJ2EAv1R6UaZqc4iOCyj?si=mxc5IMM9RQeEPmY0KBIfjg`
- [x] Short link; `https://spotify.link/zu1pVRAg6Db`
- [x] String; `mirror heart`

## Installation

> npm i damonjs-spotify

## Links

- DamonJs; [npm](https://www.npmjs.com/package/damonjs) [github](https://github.com/achiragaming/damonjs)
- DamonJs-Spotify; [npm](https://www.npmjs.com/package/damonjs-spotify)

#### How to

```js
const { DamonJs } = require('damonjs');
const Spotify = require('damonjs-spotify');

const DamonJs = new DamonJs(
  {
    plugins: [
      new Spotify({
        clientId: '',
        clientSecret: '',
        playlistPageLimit: 1, // optional ( 100 tracks per page )
        albumPageLimit: 1, // optional ( 50 tracks per page )
        searchLimit: 10, // optional ( track search limit. Max 50 )
        searchMarket: 'US', // optional || default: US ( Enter the country you live in. [ Can only be of 2 letters. For eg: US, IN, EN ] )//
      }),
    ],
  },
  new Connectors.DiscordJS(client),
  Nodes,
);

DamonJs.search(`https://open.spotify.com/track/7nw4ElerVAP5235FN5D2OI`); // track, album, playlist, artist
DamonJs.search('mirror heart', { engine: 'spotify' }); // search track using spotify
```
