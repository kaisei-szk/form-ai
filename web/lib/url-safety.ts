import { lookup } from 'dns/promises'
import { isIP } from 'net'

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true
  const [a, b] = octets
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address)
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7))
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
}

export async function parsePublicHttpUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported_protocol')
  if (url.username || url.password) throw new Error('url_credentials_not_allowed')
  if (url.hostname.toLowerCase() === 'localhost') throw new Error('private_address_not_allowed')

  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('private_address_not_allowed')
  }
  return url
}
