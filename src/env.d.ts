/// <reference types="astro/client" />
interface ImportMetaEnv {
 readonly PUBLIC_MAPBOX_TOKEN?: string;
 readonly PUBLIC_MAPBOX_STYLE?: string;
 readonly PUBLIC_ROUTING_PROFILE?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
