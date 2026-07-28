import type { MoliuApi } from '../../shared/contracts'

declare global {
  interface Window {
    moliu: MoliuApi
  }
}

export {}
