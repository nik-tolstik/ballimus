import developmentLogo from '@/assets/ballimus-dev.webp'
import productionLogo from '@/assets/ballimus-prod.webp'

export interface ApplicationBrand {
  readonly name: 'Ballimus' | 'Ballimus Dev'
  readonly logo: string
}

export function brandForEnvironment(production: boolean): ApplicationBrand {
  return production
    ? { name: 'Ballimus', logo: productionLogo }
    : { name: 'Ballimus Dev', logo: developmentLogo }
}

export const applicationBrand = brandForEnvironment(import.meta.env.PROD)
