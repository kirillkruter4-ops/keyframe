/// <reference types="vite/client" />

import type { KeyframeApi } from '../../preload'

declare global {
  interface Window {
    keyframe: KeyframeApi
  }
}

declare module '*.svg' {
  const src: string
  export default src
}

export {}
