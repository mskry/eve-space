import { readFile } from 'node:fs/promises'

const REVIEW_SOURCE = 'docs/fetching-layer-review-frontend.md'
const ROW_PATTERN = /^\|(.+)\|$/gm
const QUERY_NAME_PATTERN = /`(\w+)`/
const ROUTE_PATTERN = /`(GET|POST|PUT|PATCH|DELETE) ([^`\s]+)`/

const ACCESS_LABELS = [
  ['owned character', 'owned_character'],
  ['organization', 'organization_permission'],
  ['admin', 'administrator_session'],
  ['application session', 'application_session'],
  ['public', 'public'],
] as const

export interface LabelledRequest {
  name: string
  method: string
  requestPath: string
  credentialRequirement: string
  ssrGated: boolean
  trigger: string
}

export const loadLabelledRequests = async (root: URL): Promise<LabelledRequest[]> => {
  const source = await readFile(new URL(REVIEW_SOURCE, root), 'utf8')

  return [...source.matchAll(ROW_PATTERN)]
    .map((match) => match[1].split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 5)
    .flatMap(toLabelledRequest)
}

const toLabelledRequest = (cells: readonly string[]): LabelledRequest[] => {
  const [consumer, , trigger, route, access] = cells
  const name = QUERY_NAME_PATTERN.exec(consumer)?.[1]
  const mounted = ROUTE_PATTERN.exec(route)

  if (!name || !mounted) return []

  return [
    {
      name,
      method: mounted[1],
      requestPath: mounted[2],
      credentialRequirement: credentialRequirementOf(access),
      ssrGated: !/ssr-capable|supports public ssr/i.test(trigger),
      trigger,
    },
  ]
}

const credentialRequirementOf = (access: string) => {
  const label = ACCESS_LABELS.find(([needle]) => access.toLowerCase().includes(needle))

  return label ? label[1] : 'unknown'
}
