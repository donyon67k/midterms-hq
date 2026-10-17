// Regional groupings for zooming the national map into an area.
export const REGIONS = [
  { key: 'newengland', label: 'NEW ENGLAND', states: ['ME', 'NH', 'VT', 'MA', 'RI', 'CT'] },
  { key: 'midatlantic', label: 'MID-ATLANTIC', states: ['NY', 'NJ', 'PA', 'DE', 'MD'] },
  { key: 'southeast', label: 'SOUTHEAST', states: ['VA', 'WV', 'KY', 'TN', 'NC', 'SC', 'GA', 'FL', 'AL', 'MS'] },
  { key: 'greatlakes', label: 'GREAT LAKES', states: ['OH', 'MI', 'IN', 'IL', 'WI', 'MN'] },
  { key: 'plains', label: 'PLAINS', states: ['ND', 'SD', 'NE', 'KS', 'IA', 'MO'] },
  { key: 'southcentral', label: 'SOUTH CENTRAL', states: ['TX', 'OK', 'AR', 'LA'] },
  { key: 'southwest', label: 'SOUTHWEST', states: ['AZ', 'NM', 'NV', 'UT'] },
  { key: 'mountain', label: 'MOUNTAIN WEST', states: ['MT', 'ID', 'WY', 'CO'] },
  { key: 'pacific', label: 'PACIFIC', states: ['WA', 'OR', 'CA', 'AK', 'HI'] },
]

export const REGION_BY_KEY = Object.fromEntries(REGIONS.map((r) => [r.key, r]))
export const regionOf = (st) => REGIONS.find((r) => r.states.includes(st))
