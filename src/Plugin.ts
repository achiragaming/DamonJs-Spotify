import {
  DamonJsPlugin as Plugin,
  DamonJsSearchOptions,
  DamonJsSearchResult,
  DamonJs,
  DamonJsError,
  DamonJsTrack,
  SearchResultTypes,
  DamonJsPlayer,
} from 'damonjs';
import { packageData } from './Index';
import { RequestManager } from './RequestManager';
import undici from 'undici';
const REGEX = /(?:https:\/\/open\.spotify\.com\/|spotify:)(?:.+)?(track|playlist|album|artist)[\/:]([A-Za-z0-9]+)/;
const SHORT_REGEX = /(?:https:\/\/spotify\.link)\/([A-Za-z0-9]+)/;

export interface SpotifyOptions {
  /** The client ID of your Spotify application. */
  clientId: string;
  /** The client secret of your Spotify application. */
  clientSecret: string;
  /** The clients for multiple spotify applications. NOT RECOMMENDED */
  clients?: { clientId: string; clientSecret: string }[];
  /** 100 tracks per page */
  playlistPageLimit?: number;
  /** 50 tracks per page */
  albumPageLimit?: number;
  /** The track limit when searching track */
  searchLimit?: number;
  /** Enter the country you live in. ( Can only be of 2 letters. For eg: US, IN, EN) */
  searchMarket?: string;
}

export class DamonJsPlugin extends Plugin {
  /**
   * The options of the plugin.
   */
  public options: SpotifyOptions;

  private _search:
    | ((player: DamonJsPlayer, query: string, options: DamonJsSearchOptions) => Promise<DamonJsSearchResult>)
    | null;

  private DamonJs: DamonJs | null;
  private undici = undici;

  private readonly methods: Record<string, (id: string, requester: unknown) => Promise<Result>>;
  private requestManager: RequestManager;
  buildSearch:
    | ((
        playlistInfo?:
          | { encoded: string; info: { name: string; selectedTrack: number }; pluginInfo: unknown }
          | undefined,
        tracks?: DamonJsTrack[] | undefined,
        type?: SearchResultTypes | undefined,
      ) => DamonJsSearchResult)
    | null;

  constructor(spotifyOptions: SpotifyOptions) {
    super();
    this.options = spotifyOptions;
    this.requestManager = new RequestManager(spotifyOptions);

    this.methods = {
      track: this.getTrack.bind(this),
      album: this.getAlbum.bind(this),
      artist: this.getArtist.bind(this),
      playlist: this.getPlaylist.bind(this),
    };
    this.DamonJs = null;
    this.buildSearch = null;
    this._search = null;
  }

  public load(DamonJs: DamonJs) {
    this.DamonJs = DamonJs;
    this._search = DamonJs.search.bind(DamonJs);
    this.buildSearch = DamonJs.buildSearch.bind(DamonJs);
    DamonJs.search = this.search.bind(this);
  }
  private get pluginInfo() {
    return { ...packageData };
  }
  private async search(
    player: DamonJsPlayer,
    query: string,
    options: DamonJsSearchOptions,
  ): Promise<DamonJsSearchResult> {
    if (!this.DamonJs || !this._search || !this.buildSearch)
      throw new DamonJsError(1, 'DamonJs-spotify is not loaded yet.');

    if (!query) throw new DamonJsError(3, 'Query is required');
    const [, type, id] = REGEX.exec(query) || [];

    const isUrl = /^https?:\/\//.test(query);

    if (SHORT_REGEX.test(query)) {
      const res = await this.undici.request(query, { method: 'HEAD' });
      query = String(res.headers.location);
    }

    if (type in this.methods) {
      try {
        const _function = this.methods[type];
        const result: Result = await _function(id, options?.requester);

        const loadType = type === 'track' ? SearchResultTypes.Track : SearchResultTypes.Playlist;
        const tracks = result.tracks.filter(this.filterNullOrUndefined);
        if (tracks.length && loadType === SearchResultTypes.Playlist) {
          return this.buildSearch(
            {
              encoded: '',
              info: { name: result.name || '', selectedTrack: 0 },
              pluginInfo: this.pluginInfo,
            },
            tracks,
            loadType,
          );
        } else if (tracks.length && loadType === SearchResultTypes.Track) {
          return this.buildSearch(undefined, tracks, loadType);
        } else {
          return this.buildSearch(undefined, [], SearchResultTypes.Empty);
        }
      } catch (e) {
        return this.buildSearch(undefined, undefined, SearchResultTypes.Error);
      }
    } else if (options?.engine === 'spotify' && !isUrl) {
      const result = await this.searchTrack(query, options?.requester);

      return this.buildSearch(undefined, result.tracks, SearchResultTypes.Search);
    }

    return this._search(player, query, options);
  }

  private async searchTrack(query: string, requester: unknown): Promise<Result> {
    const limit =
      this.options.searchLimit && this.options.searchLimit > 0 && this.options.searchLimit < 50
        ? this.options.searchLimit
        : 10;
    const tracks = await this.requestManager.makeRequest<SearchResult>(
      `/search?q=${decodeURIComponent(query)}&type=track&limit=${limit}&market=${this.options.searchMarket ?? 'US'}`,
    );
    return {
      tracks: tracks.tracks.items.map((track) => this.buildDamonJsTrack(track, requester)),
    };
  }

  private async getTrack(id: string, requester: unknown): Promise<Result> {
    const track = await this.requestManager.makeRequest<TrackResult>(`/tracks/${id}`);
    return { tracks: [this.buildDamonJsTrack(track, requester)] };
  }

  private async getAlbum(id: string, requester: unknown): Promise<Result> {
    const album = await this.requestManager.makeRequest<AlbumResult>(
      `/albums/${id}?market=${this.options.searchMarket ?? 'US'}`,
    );
    const tracks = album.tracks.items
      .filter(this.filterNullOrUndefined)
      .map((track) => this.buildDamonJsTrack(track, requester, album.images[0]?.url));

    if (album && tracks.length) {
      let next = album.tracks.next;
      let page = 1;

      while (next && (!this.options.playlistPageLimit ? true : page < this.options.playlistPageLimit ?? 1)) {
        const nextTracks = await this.requestManager.makeRequest<PlaylistTracks>(next ?? '', true);
        page++;
        if (nextTracks.items.length) {
          next = nextTracks.next;
          tracks.push(
            ...nextTracks.items
              .filter(this.filterNullOrUndefined)
              .filter((a) => a.track)
              .map((track) => this.buildDamonJsTrack(track.track!, requester, album.images[0]?.url)),
          );
        }
      }
    }

    return { tracks, name: album.name };
  }

  private async getArtist(id: string, requester: unknown): Promise<Result> {
    const artist = await this.requestManager.makeRequest<Artist>(`/artists/${id}`);
    const fetchedTracks = await this.requestManager.makeRequest<ArtistResult>(
      `/artists/${id}/top-tracks?market=${this.options.searchMarket ?? 'US'}`,
    );

    const tracks = fetchedTracks.tracks
      .filter(this.filterNullOrUndefined)
      .map((track) => this.buildDamonJsTrack(track, requester, artist.images[0]?.url));

    return { tracks, name: artist.name };
  }

  private async getPlaylist(id: string, requester: unknown): Promise<Result> {
    const playlist = await this.requestManager.makeRequest<PlaylistResult>(
      `/playlists/${id}?market=${this.options.searchMarket ?? 'US'}`,
    );

    const tracks = playlist.tracks.items
      .filter(this.filterNullOrUndefined)
      .map((track) => this.buildDamonJsTrack(track.track, requester, playlist.images[0]?.url));

    if (playlist && tracks.length) {
      let next = playlist.tracks.next;
      let page = 1;
      while (next && (!this.options.playlistPageLimit ? true : page < this.options.playlistPageLimit ?? 1)) {
        const nextTracks = await this.requestManager.makeRequest<PlaylistTracks>(next ?? '', true);
        page++;
        if (nextTracks.items.length) {
          next = nextTracks.next;
          tracks.push(
            ...nextTracks.items
              .filter(this.filterNullOrUndefined)
              .filter((a) => a.track)
              .map((track) => this.buildDamonJsTrack(track.track!, requester, playlist.images[0]?.url)),
          );
        }
      }
    }
    return { tracks, name: playlist.name };
  }

  private filterNullOrUndefined(obj: unknown): obj is unknown {
    return obj !== undefined && obj !== null;
  }

  private buildDamonJsTrack(spotifyTrack: Track, requester: unknown, thumbnail?: string) {
    return new DamonJsTrack(
      {
        encoded: '',
        info: {
          sourceName: 'spotify',
          identifier: spotifyTrack.id,
          isSeekable: true,
          author: spotifyTrack.artists[0] ? spotifyTrack.artists[0].name : 'Unknown',
          length: spotifyTrack.duration_ms,
          isStream: false,
          position: 0,
          title: spotifyTrack.name,
          uri: `https://open.spotify.com/track/${spotifyTrack.id}`,
          artworkUrl: thumbnail ? thumbnail : spotifyTrack.album?.images[0]?.url,
        },
        pluginInfo: this.pluginInfo,
      },
      requester,
    );
  }
}

export interface SearchResult {
  tracks: Tracks;
}

export interface Result {
  tracks: DamonJsTrack[];
  name?: string;
}

export interface TrackResult {
  album: Album;
  artists: Artist[];
  available_markets: string[];
  disc_number: number;

  duration_ms: number;
  explicit: boolean;
  external_ids: ExternalIds;
  external_urls: ExternalUrls;
  href: string;
  id: string;
  is_local: boolean;
  name: string;
  popularity: number;
  preview_url: string;
  track: any;
  track_number: number;
  type: string;
  uri: string;
}

export interface AlbumResult {
  album_type: string;
  artists: Artist[];
  available_markets: string[];
  copyrights: Copyright[];
  external_ids: ExternalIds;
  external_urls: ExternalUrls;
  genres: string[];
  href: string;
  id: string;
  images: Image[];
  label: string;
  name: string;
  popularity: number;
  release_date: string;
  release_date_precision: string;
  total_tracks: number;
  tracks: Tracks;
  type: string;
  uri: string;
}

export interface ArtistResult {
  tracks: Track[];
}

export interface PlaylistResult {
  collaborative: boolean;
  description: string;
  external_urls: ExternalUrls;
  followers: Followers;
  href: string;
  id: string;
  images: Image[];
  name: string;
  owner: Owner;
  primary_color: string | null;
  public: boolean;
  snapshot_id: string;
  tracks: PlaylistTracks;
  type: string;
  uri: string;
}

export interface Owner {
  display_name: string;
  external_urls: ExternalUrls;
  href: string;
  id: string;
  type: string;
  uri: string;
}

export interface Followers {
  href: string | null;
  total: number;
}

export interface Tracks {
  href: string;
  items: Track[];
  next: string | null;
}

export interface PlaylistTracks {
  href: string;
  items: SpecialTracks[];
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
}

export interface SpecialTracks {
  added_at: string;
  is_local: boolean;
  primary_color: string | null;
  track: Track;
}

export interface Copyright {
  text: string;
  type: string;
}

export interface ExternalUrls {
  spotify: string;
}

export interface ExternalIds {
  isrc: string;
}

export interface Album {
  album_type: string;
  artists: Artist[];
  available_markets: string[];
  external_urls: { [key: string]: string };
  href: string;
  id: string;
  images: Image[];
  name: string;
  release_date: string;
  release_date_precision: string;
  total_tracks: number;
  type: string;
  uri: string;
}

export interface Image {
  height: number;
  url: string;
  width: number;
}

export interface Artist {
  external_urls: {
    spotify: string;
  };
  followers: {
    href: string;
    total: number;
  };
  genres: [];
  href: string;
  id: string;
  images: Image[];
  name: string;
  popularity: number;
  type: string;
  uri: string;
}

export interface Track {
  album?: Album;
  artists: Artist[];
  available_markets: string[];
  disc_number: number;
  duration_ms: number;
  explicit: boolean;
  external_urls: ExternalUrls;
  href: string;
  id: string;
  is_local: boolean;
  name: string;
  preview_url: string;
  track_number: number;
  type: string;
  uri: string;
}
