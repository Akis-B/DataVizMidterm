import { useEffect, useState, type MouseEvent } from 'react'
import treeDataCsv from '../Data/CleanedTreeData.csv?raw'
import neighborhoodsCsv from '../Data/NeighborhoodCoordinates.csv?raw'
import rentDataCsv from '../Data/StreetEasyRentDataCL.csv?raw'
import './App.css'

const GRID_SIZE = 12
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const DEFAULT_CELL_COLOR = '#160B06'
const TOOLTIP_GAP = 16
const TOOLTIP_LINE_HEIGHT = 2.1
const TOOLTIP_FONT_SIZE_MIN_PX = 9
const TOOLTIP_FONT_SIZE_MAX_PX = 18
const TOOLTIP_FONT_SIZE_VIEWPORT_RATIO = 0.015
const TOOLTIP_PADDING_X_SCALE = 1.25
const TOOLTIP_PADDING_Y_SCALE = 0.55
const MODAL_LINE_HEIGHT = 1.6
const NEAREST_NEIGHBOR_COUNT = 3
const MOBILE_POINTER_QUERY = '(pointer: coarse)'

let measurementContext: CanvasRenderingContext2D | null = null

const ACCESSIBILITY_COLORS = {
  excellent: '#0C3B1D',
  great: '#1C7F3B',
  fair: '#FFFFFF',
  poor: '#C0392B',
  unknown: '#3A2A24',
} as const

const RENT_KEY_ALIASES: Record<string, string> = {
  'gramecy park': 'gramercy park',
  'stuyvesant town': 'stuyvesant town/pcv',
}

type TreeRecord = {
  treeId: string
  status: string
  sidewalk: string
  problems: string
  latitude: number
  longitude: number
  neighborhood: string
  species: string
  treeFriendsScore: number
  affordabilityScore: number | null
  accessibilityScore: number | null
}

type NeighborhoodRecord = {
  name: string
  latitude: number
  longitude: number
}

type TooltipMetrics = {
  fontSizePx: number
  paddingXPx: number
  paddingYPx: number
}

type TooltipState = {
  lines: TooltipLine[]
  x: number
  y: number
  metrics: TooltipMetrics
}

type TooltipLine = {
  text: string
  deadSuffix?: string
}

type NeighborhoodMatch = {
  name: string
  distance: number
  rent: number | null
}

type IndexedTreePoint = {
  tree: TreeRecord
  latitude: number
  longitude: number
  index: number
}

type KdTreeNode = {
  point: IndexedTreePoint
  axis: 0 | 1
  left: KdTreeNode | null
  right: KdTreeNode | null
}

const rentLookup = parseRentData(rentDataCsv)
const neighborhoods = parseNeighborhoodData(neighborhoodsCsv)
const trees = parseTreeData(treeDataCsv, neighborhoods, rentLookup)

function App() {
  const [cellTreeIndices, setCellTreeIndices] = useState(() =>
    Array.from({ length: CELL_COUNT }, () => getRandomTreeIndex()),
  )
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(true)
  const [modalFontSizePx, setModalFontSizePx] = useState(() => getResponsiveFontSizePx())
  const [mobileActiveCell, setMobileActiveCell] = useState<number | null>(null)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => setModalFontSizePx(getResponsiveFontSizePx())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isMobile) {
      setMobileActiveCell(null)
    }
  }, [isMobile])

  const updateTooltip = (event: MouseEvent<HTMLButtonElement>, tree: TreeRecord) => {
    const tooltipLines = getTreeTooltipContent(tree)
    const tooltipText = tooltipLines
      .map((line) => (line.deadSuffix ? `${line.text} ${line.deadSuffix}` : line.text))
      .join('\n')
    const metrics = getTooltipMetrics()
    const position = calculateTooltipPosition(tooltipText, event.clientX, event.clientY, metrics)
    setTooltip({
      lines: tooltipLines,
      metrics,
      ...position,
    })
  }

  const handleCellMouseLeave = (cellIndex: number) => {
    if (trees.length === 0) return
    setCellTreeIndices((previous) => {
      const next = [...previous]
      next[cellIndex] = getRandomTreeIndex()
      return next
    })
    setTooltip(null)
    setMobileActiveCell((active) => (active === cellIndex ? null : active))
  }

  const handleMobileTooltipRequest = (
    cellIndex: number,
    event: MouseEvent<HTMLButtonElement>,
    tree: TreeRecord,
  ) => {
    if (mobileActiveCell != null && mobileActiveCell !== cellIndex) {
      handleCellMouseLeave(mobileActiveCell)
    }
    setMobileActiveCell(cellIndex)
    updateTooltip(event, tree)
  }

  const closeModal = () => setIsModalOpen(false)

  return (
    <main className="app">
      <header className="app__header">
        <button
          type="button"
          className="app__help-button"
          aria-label="Show project onboarding"
          onClick={() => setIsModalOpen(true)}
        >
          ?
        </button>
      </header>
      {isModalOpen && (
        <div className="app__modal-overlay" role="presentation" onClick={closeModal}>
          <div
            className="app__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-modal-title"
            aria-describedby="onboarding-modal-body"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="app__modal-close" aria-label="Close onboarding" onClick={closeModal}>
              ×
            </button>
            <h1
              id="onboarding-modal-title"
              className="app__modal-title"
              style={{ fontSize: `${modalFontSizePx * 2}px`, lineHeight: MODAL_LINE_HEIGHT }}
            >
              Random Roots
            </h1>
            <div
              id="onboarding-modal-body"
              className="app__modal-body"
              style={{ fontSize: `${modalFontSizePx}px`, lineHeight: MODAL_LINE_HEIGHT }}
            >
              <p>
                Random Roots is a conceptual project that explores how urban trees in New York City can be represented,
                ranked, and interpreted through the lens of accessibility.
              </p>
              <p>
                The interface displays a mosaic of neutral buttons, each corresponding to a tree in Manhattan as recorded
                in the 2015 NYC Tree Census. At first, every button appears uncolored. The color is only revealed when
                the user hovers over a button, temporarily uncovering the tree&apos;s accessibility score:
              </p>
              <p>
                Dark green signifies a tree that is classified as more accessible.
                <br />
                Red indicates a tree that is less accessible.
              </p>
              <p>
                Once the user moves the cursor away, that tree disappears from view and is replaced by another randomly
                selected one. This cycle prevents returning to the same tree and introduces a deliberate element of
                ephemerality and impermanence. The mechanic mirrors both the transient nature of digital interaction and
                the ongoing change within ecological systems.
              </p>
              <p>
                By clicking on a button during the brief moment it is visible, users can access the tree&apos;s
                coordinates on Google Maps, where they may explore its location and surroundings through Street View.
                (Note: since the underlying data originates from 2015, certain entries may not fully reflect current
                conditions.)
              </p>
              <p>
                The project draws on two public datasets:
              </p>
              <ul className="app__modal-list">
                <li>- The 2015 NYC Tree Census from NYC Open Data</li>
                <li>- The StreetEasy median rent dataset from November 2025</li>
              </ul>
              <p>
                Two calculated indices inform the visualization:
              </p>
              <ul className="app__modal-list">
                <li>
                  - The Tree Friends Index (0&ndash;4) measures how densely a tree is surrounded by others. A score of 4
                  corresponds to an average spacing of approximately three meters between the five nearest trees.
                </li>
                <li>
                  - The Affordability Score represents the relative housing cost associated with each tree&apos;s
                  location, where higher values indicate areas with lower median rent.
                </li>
              </ul>
              <p>
                Inspired by the DxD 2025 theme &quot;Ecosystems and Cycles of Life,&quot; Random Roots investigates the
                cyclical dynamics between environment, data, and perception. The constant regeneration of tree
                representations reflects the recursive patterns of growth, decay, and renewal found in both urban and
                natural systems.
              </p>
              <p>
                While the project employs quantitative methods, it also engages critically with them. The act of ranking
                trees is intentionally self-contradictory: a commentary on the ways urban data practices can transform
                living environments into metrics. Random Roots invites reflection on how systems of categorization
                mediate our understanding of both nature and the city.
              </p>
            </div>
          </div>
        </div>
      )}
      {tooltip && (
        <div
          className="app__tooltip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            fontSize: `${tooltip.metrics.fontSizePx}px`,
            padding: `${tooltip.metrics.paddingYPx}px ${tooltip.metrics.paddingXPx}px`,
          }}
        >
          {tooltip.lines.map((line, index) => (
            <span key={`${line.text}-${line.deadSuffix ?? ''}-${index}`} className="app__tooltip-line">
              {line.text}
              {line.deadSuffix && (
                <>
                  {' '}
                  <span className="app__tooltip-line--dead">{line.deadSuffix}</span>
                </>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="app__content">
        <div className="app__stage">
          <div className="app__canvas">
            {Array.from({ length: CELL_COUNT }).map((_, index) => {
              const tree = trees[cellTreeIndices[index]]
              return (
                <Cell
                  key={index}
                  index={index}
                  tree={tree}
                  isMobile={isMobile}
                  mobileActiveCell={mobileActiveCell}
                  onMouseLeave={() => handleCellMouseLeave(index)}
                  onHoverStart={updateTooltip}
                  onHoverMove={updateTooltip}
                  onHoverEnd={() => setTooltip(null)}
                  onMobileTooltipRequest={(event, tappedTree) =>
                    handleMobileTooltipRequest(index, event, tappedTree)
                  }
                />
              )
            })}
          </div>
        </div>
      </div>
    </main>
  )
}

export default App

type CellProps = {
  index: number
  tree?: TreeRecord
  isMobile: boolean
  mobileActiveCell: number | null
  onMouseLeave: () => void
  onHoverStart: (event: MouseEvent<HTMLButtonElement>, tree: TreeRecord) => void
  onHoverMove: (event: MouseEvent<HTMLButtonElement>, tree: TreeRecord) => void
  onHoverEnd: () => void
  onMobileTooltipRequest: (event: MouseEvent<HTMLButtonElement>, tree: TreeRecord) => void
}

function Cell({
  index,
  tree,
  isMobile,
  mobileActiveCell,
  onMouseLeave,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  onMobileTooltipRequest,
}: CellProps) {
  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    if (!tree || isMobile) return
    event.currentTarget.style.backgroundColor = getAccessibilityColor(tree.accessibilityScore)
    onHoverStart(event, tree)
  }

  const handleMouseMove = (event: MouseEvent<HTMLButtonElement>) => {
    if (!tree || isMobile) return
    onHoverMove(event, tree)
  }

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    if (isMobile) return
    event.currentTarget.style.backgroundColor = DEFAULT_CELL_COLOR
    onHoverEnd()
    onMouseLeave()
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!tree) return
    if (isMobile) {
      if (mobileActiveCell === index) {
        onHoverEnd()
        onMouseLeave()
        openTreeLocation(tree)
        return
      }
      onMobileTooltipRequest(event, tree)
      return
    }

    openTreeLocation(tree)
  }

  const mobileActiveStyle =
    isMobile && tree && mobileActiveCell === index
      ? { backgroundColor: getAccessibilityColor(tree.accessibilityScore) }
      : undefined

  return (
    <button
      type="button"
      className="app__cell"
      aria-label={`Cell ${Math.floor(index / GRID_SIZE) + 1}, ${index % GRID_SIZE + 1}`}
      style={mobileActiveStyle}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  )
}

function openTreeLocation(tree: TreeRecord): void {
  const url = `https://www.google.com/maps/search/?api=1&query=${tree.latitude},${tree.longitude}`
  window.open(url, '_blank', 'noopener')
}

function parseTreeData(
  csvData: string,
  neighborhoods: NeighborhoodRecord[],
  rentLookup: Map<string, number>,
): TreeRecord[] {
  const normalizedData = csvData.replace(/^\uFEFF/, '').trim()
  const lines = normalizedData.split(/\r?\n/).filter(Boolean)
  if (lines.length <= 1) return []

  const headers = parseCsvLine(lines[0])

  const parsedTrees = lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    const row = headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})

    const latitude = Number(row.latitude)
    const longitude = Number(row.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined

    const nearestMatches = getClosestNeighborhoodMatches(
      latitude,
      longitude,
      neighborhoods,
      rentLookup,
      NEAREST_NEIGHBOR_COUNT,
    )
    const closestNeighborhood = nearestMatches[0]?.name ?? 'Unknown'
    const expectedRent = calculateExpectedRent(nearestMatches)
    const affordabilityScore = expectedRent != null ? calculateAffordabilityScore(expectedRent) : null

    const treeRecord: TreeRecord = {
      treeId: (row.tree_id ?? '').trim() || 'unknown',
      status: row.status?.trim() ?? '',
      sidewalk: row.sidewalk?.trim() ?? '',
      problems: row.problems?.trim() ?? '',
      latitude,
      longitude,
      neighborhood: closestNeighborhood,
      species: (row.spc_common ?? '').trim().toLowerCase() || 'unknown',
      treeFriendsScore: 0,
      affordabilityScore,
      accessibilityScore: null,
    }
    return treeRecord
  }).filter((tree): tree is TreeRecord => Boolean(tree))

  assignTreeFriendsScores(parsedTrees)
  assignAccessibilityScores(parsedTrees)
  return parsedTrees
}

function parseNeighborhoodData(csvData: string): NeighborhoodRecord[] {
  const normalizedData = csvData.replace(/^\uFEFF/, '').trim()
  const lines = normalizedData.split(/\r?\n/).filter(Boolean)
  if (lines.length <= 1) return []

  const headers = parseCsvLine(lines[0])

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    const row = headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})

    const latitude = Number(row.latitude)
    const longitude = Number(row.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined

    return {
      name: normalizeNeighborhoodName(row.name ?? ''),
      latitude,
      longitude,
    }
  }).filter((neighborhood): neighborhood is NeighborhoodRecord => Boolean(neighborhood))
}

function normalizeNeighborhoodName(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed || 'Unknown'
}

function parseRentData(csvData: string): Map<string, number> {
  const rentLookup = new Map<string, number>()
  const normalizedData = csvData.replace(/^\uFEFF/, '').trim()
  const lines = normalizedData.split(/\r?\n/).filter(Boolean)
  if (lines.length <= 1) return rentLookup

  const headers = parseCsvLine(lines[0])
  const nameIndex = headers.findIndex((header) => header.toLowerCase() === 'areaname')
  const rentIndex = headers.findIndex((header) => header.toLowerCase() === 'rent')

  if (nameIndex === -1 || rentIndex === -1) return rentLookup

  lines.slice(1).forEach((line) => {
    const values = parseCsvLine(line)
    const key = normalizeRentKey(values[nameIndex] ?? '')
    const rentValue = Number(values[rentIndex])
    if (!key || !Number.isFinite(rentValue)) return
    rentLookup.set(key, rentValue)
  })

  return rentLookup
}

function normalizeRentKey(value: string): string {
  const normalized = normalizeNeighborhoodName(value)
  if (!normalized || normalized === 'Unknown') return ''
  const lowered = normalized.toLowerCase()
  return RENT_KEY_ALIASES[lowered] ?? lowered
}

function getNeighborhoodRent(name: string, rentLookup: Map<string, number>): number | null {
  const key = normalizeRentKey(name)
  if (!key) return null
  return rentLookup.get(key) ?? null
}

function getClosestNeighborhoodMatches(
  latitude: number,
  longitude: number,
  neighborhoods: NeighborhoodRecord[],
  rentLookup: Map<string, number>,
  limit: number,
): NeighborhoodMatch[] {
  if (neighborhoods.length === 0 || limit <= 0) return []

  const matches: NeighborhoodMatch[] = []

  neighborhoods.forEach((neighborhood) => {
    const distance = getDistanceInMeters(latitude, longitude, neighborhood.latitude, neighborhood.longitude)
    if (!Number.isFinite(distance)) return

    const match = {
      name: neighborhood.name,
      distance,
      rent: getNeighborhoodRent(neighborhood.name, rentLookup),
    }

    if (matches.length < limit) {
      matches.push(match)
      matches.sort((a, b) => a.distance - b.distance)
      return
    }

    const farthestDistance = matches[matches.length - 1]?.distance ?? Number.POSITIVE_INFINITY
    if (distance < farthestDistance) {
      matches[matches.length - 1] = match
      matches.sort((a, b) => a.distance - b.distance)
    }
  })

  return matches
}

function calculateExpectedRent(matches: NeighborhoodMatch[]): number | null {
  if (matches.length < 3) return null
  const [x1, x2, x3] = matches
  if (x1.rent == null || x2.rent == null || x3.rent == null) return null

  const d1 = Math.max(x1.distance, 0)
  const d2 = Math.max(x2.distance, 0)
  const d3 = Math.max(x3.distance, 0)

  const denominator = d1 + d2 + d3
  if (denominator === 0) {
    return (x1.rent + x2.rent + x3.rent) / 3
  }

  const weight1 = (d2 + d3 - d1) / denominator
  const weight2 = (d1 + d3 - d2) / denominator
  const weight3 = (d1 + d2 - d3) / denominator

  return weight1 * x1.rent + weight2 * x2.rent + weight3 * x3.rent
}

function calculateAffordabilityScore(expectedRent: number): number {
  if (!Number.isFinite(expectedRent) || expectedRent === 0) return 0
  const score = 36370 / expectedRent - 2.737
  return clamp(score, 0, 10)
}

function getDistanceInMeters(
  originLat: number,
  originLng: number,
  targetLat: number,
  targetLng: number,
): number {
  const earthRadius = 6371_000
  const dLat = toRadians(targetLat - originLat)
  const dLng = toRadians(targetLng - originLng)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(originLat)) * Math.cos(toRadians(targetLat)) * Math.sin(dLng / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result
}

function getRandomTreeIndex(): number {
  if (trees.length === 0) return -1
  return Math.floor(Math.random() * trees.length)
}

function getTreeTooltipContent(tree: TreeRecord): TooltipLine[] {
  const lines: TooltipLine[] = [
    { text: tree.treeId ? `tree-#${tree.treeId}` : 'tree-#unknown' },
    { text: `Accessibility: ${formatAccessibilityScore(tree.accessibilityScore)}` },
    { text: `Neighborhood: ${tree.neighborhood}` },
    { text: `Coordinates: ${formatCoordinate(tree.latitude)}, ${formatCoordinate(tree.longitude)}` },
    { text: `Species: ${tree.species || 'unknown'}` },
    { text: `Tree Friends: ${formatTreeFriendsScore(tree.treeFriendsScore)}` },
    { text: `Affordability: ${formatAffordabilityScore(tree.affordabilityScore)}` },
    { text: `Health: ${formatHealthScore(tree)}` },
  ]

  if (shouldShowProblems(tree)) {
    const isDead = tree.status.trim().toLowerCase() === 'dead'
    if (isDead) {
      lines.push({
        text: 'Problems:',
        deadSuffix: 'dead',
      })
    } else {
      lines.push({
        text: `Problems: ${formatProblems(tree)}`,
      })
    }
  }

  return lines
}

function formatTreeFriendsScore(score: number): string {
  return normalizeTreeFriendsScore(score).toFixed(1)
}

function formatAffordabilityScore(value: number | null): string {
  return normalizeAffordabilityScore(value).toFixed(1)
}

function formatAccessibilityScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return '0.0'
  return score.toFixed(1)
}

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return 'unknown'
  return value.toFixed(5)
}

function formatHealthScore(tree: TreeRecord): string {
  const score = calculateHealthScore(tree)
  if (!Number.isFinite(score)) return '0'
  return score.toFixed(0)
}

function calculateHealthScore(tree: TreeRecord): number {
  const status = tree.status.toLowerCase()
  if (status === 'stump' || status === 'dead') {
    return 0
  }

  let differences = 0
  if (tree.status.toLowerCase() !== 'alive') differences += 1
  if (tree.sidewalk.toLowerCase() !== 'nodamage') differences += 1
  if (tree.problems && tree.problems.trim().toLowerCase() !== 'none') differences += 1

  if (differences === 0) return 3
  if (differences === 1) return 2
  return 1
}

function shouldShowProblems(tree: TreeRecord): boolean {
  if (tree.status.trim().toLowerCase() === 'dead') return true
  return calculateHealthScore(tree) !== 3
}

function formatProblems(tree: TreeRecord): string {
  const rawProblems = tree.problems?.trim()
  if (rawProblems && rawProblems.toLowerCase() !== 'none') {
    return rawProblems
  }

  const sidewalkIssue = tree.sidewalk?.trim()
  if (sidewalkIssue && sidewalkIssue.toLowerCase() !== 'nodamage') {
    return sidewalkIssue
  }

  return 'Unknown'
}

function normalizeTreeFriendsScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return (clamp(score, 0, 10) / 10) * 4
}

function normalizeAffordabilityScore(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0
  return (clamp(value, 0, 10) / 10) * 4
}

function getAccessibilityColor(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return ACCESSIBILITY_COLORS.unknown
  if (score >= 8.5) return ACCESSIBILITY_COLORS.excellent
  if (score >= 7.5) return ACCESSIBILITY_COLORS.great
  if (score >= 4.5) return ACCESSIBILITY_COLORS.fair
  return ACCESSIBILITY_COLORS.poor
}

function calculateTooltipPosition(
  text: string,
  clientX: number,
  clientY: number,
  metrics: TooltipMetrics,
): { x: number; y: number } {
  if (typeof window === 'undefined') {
    return { x: clientX + TOOLTIP_GAP, y: clientY + TOOLTIP_GAP }
  }

  const { width, height } = measureTooltipSize(text, metrics)
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const spaceOnLeft = clientX - TOOLTIP_GAP - width
  if (spaceOnLeft >= TOOLTIP_GAP) {
    const y = clamp(clientY - height / 2, TOOLTIP_GAP, viewportHeight - height - TOOLTIP_GAP)
    return { x: spaceOnLeft, y }
  }

  const y = clamp(clientY + TOOLTIP_GAP, TOOLTIP_GAP, viewportHeight - height - TOOLTIP_GAP)
  const x = clamp(clientX - width / 2, TOOLTIP_GAP, viewportWidth - width - TOOLTIP_GAP)
  return { x, y }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function measureTooltipSize(text: string, metrics: TooltipMetrics): { width: number; height: number } {
  const lines = text.split('\n')
  const lineHeight = metrics.fontSizePx * TOOLTIP_LINE_HEIGHT
  const textHeight = Math.max(lineHeight * lines.length, metrics.fontSizePx)

  const fallbackLineWidth = Math.max(...lines.map((line) => line.length * metrics.fontSizePx * 0.6), 0)
  const context = getMeasurementContext()

  if (!context) {
    return {
      width: fallbackLineWidth + metrics.paddingXPx * 2,
      height: textHeight + metrics.paddingYPx * 2,
    }
  }

  context.font = `${metrics.fontSizePx}px 'Menlo', 'Courier New', monospace`
  const maxMeasuredWidth = lines.reduce((maxWidth, line) => {
    const measurement = context.measureText(line)
    return Math.max(maxWidth, measurement.width)
  }, 0)

  return {
    width: Math.max(maxMeasuredWidth, fallbackLineWidth) + metrics.paddingXPx * 2,
    height: textHeight + metrics.paddingYPx * 2,
  }
}

function getTooltipMetrics(): TooltipMetrics {
  const fontSizePx = getResponsiveFontSizePx()
  return {
    fontSizePx,
    paddingXPx: fontSizePx * TOOLTIP_PADDING_X_SCALE,
    paddingYPx: fontSizePx * TOOLTIP_PADDING_Y_SCALE,
  }
}

function getResponsiveFontSizePx(): number {
  const fallback = clamp(800 * TOOLTIP_FONT_SIZE_VIEWPORT_RATIO, TOOLTIP_FONT_SIZE_MIN_PX, TOOLTIP_FONT_SIZE_MAX_PX)
  if (typeof window === 'undefined') {
    return fallback
  }

  const viewportMin = Math.min(window.innerWidth, window.innerHeight)
  const ideal = viewportMin * TOOLTIP_FONT_SIZE_VIEWPORT_RATIO
  return clamp(ideal, TOOLTIP_FONT_SIZE_MIN_PX, TOOLTIP_FONT_SIZE_MAX_PX)
}

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementContext) return measurementContext
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null

  measurementContext = context
  return context
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => isCoarsePointerDevice())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia(MOBILE_POINTER_QUERY)
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  return isMobile
}

function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(MOBILE_POINTER_QUERY).matches
}

function assignTreeFriendsScores(trees: TreeRecord[], neighborCount = 5): void {
  if (trees.length === 0) return

  const points: IndexedTreePoint[] = trees.map((tree, index) => ({
    tree,
    latitude: tree.latitude,
    longitude: tree.longitude,
    index,
  }))

  const kdTreeRoot = buildKdTree(points)
  if (!kdTreeRoot) return

  points.forEach((point) => {
    const neighborDistances = findKNearestNeighborDistances(kdTreeRoot, point, neighborCount)
    const averageDistance =
      neighborDistances.length > 0
        ? neighborDistances.reduce((sum, distance) => sum + distance, 0) / neighborDistances.length
        : Number.POSITIVE_INFINITY

    point.tree.treeFriendsScore = getTreeFriendsScore(averageDistance)
  })
}

function assignAccessibilityScores(trees: TreeRecord[]): void {
  trees.forEach((tree) => {
    const normalizedTreeFriends = normalizeTreeFriendsScore(tree.treeFriendsScore)
    const normalizedAffordability = normalizeAffordabilityScore(tree.affordabilityScore)
    const healthScore = calculateHealthScore(tree)
    const totalScore = normalizedTreeFriends + normalizedAffordability + healthScore
    const isDead = tree.status.trim().toLowerCase() === 'dead'
    tree.accessibilityScore = isDead ? 0 : totalScore
  })
}

function buildKdTree(points: IndexedTreePoint[], depth = 0): KdTreeNode | null {
  if (points.length === 0) return null
  const axis = (depth % 2) as 0 | 1
  const sorted = [...points].sort((a, b) => (axis === 0 ? a.latitude - b.latitude : a.longitude - b.longitude))

  const medianIndex = Math.floor(sorted.length / 2)
  const medianPoint = sorted[medianIndex]

  return {
    point: medianPoint,
    axis,
    left: buildKdTree(sorted.slice(0, medianIndex), depth + 1),
    right: buildKdTree(sorted.slice(medianIndex + 1), depth + 1),
  }
}

function findKNearestNeighborDistances(
  root: KdTreeNode,
  target: IndexedTreePoint,
  k: number,
): number[] {
  const distances: number[] = []

  const search = (node: KdTreeNode | null) => {
    if (!node) return

    const targetValue = node.axis === 0 ? target.latitude : target.longitude
    const nodeValue = node.axis === 0 ? node.point.latitude : node.point.longitude
    const nextNode = targetValue < nodeValue ? node.left : node.right
    const farNode = targetValue < nodeValue ? node.right : node.left

    search(nextNode)

    if (node.point.index !== target.index) {
      const distance = getDistanceInMeters(
        target.latitude,
        target.longitude,
        node.point.latitude,
        node.point.longitude,
      )
      addDistance(distance)
    }

    const deltaDegrees = Math.abs(targetValue - nodeValue)
    const axisDistanceMeters = getAxisDistanceMeters(deltaDegrees, node.axis, target.latitude)
    const currentMaxDistance = distances[distances.length - 1] ?? Number.POSITIVE_INFINITY

    if (distances.length < k || axisDistanceMeters < currentMaxDistance) {
      search(farNode)
    }
  }

  const addDistance = (distance: number) => {
    if (!Number.isFinite(distance)) return
    distances.push(distance)
    distances.sort((a, b) => a - b)
    if (distances.length > k) {
      distances.pop()
    }
  }

  search(root)
  return distances
}

function getAxisDistanceMeters(deltaDegrees: number, axis: 0 | 1, referenceLatitude: number): number {
  if (deltaDegrees === 0) return 0
  if (axis === 0) {
    return deltaDegrees * 111_132
  }
  return deltaDegrees * getMetersPerDegreeLongitude(referenceLatitude)
}

function getMetersPerDegreeLongitude(latitude: number): number {
  const meters = 111_320 * Math.cos(toRadians(latitude))
  return Number.isFinite(meters) && meters > 0 ? meters : 0
}

function getTreeFriendsScore(averageDistance: number): number {
  if (!Number.isFinite(averageDistance) || averageDistance <= 0) {
    return 10
  }

  if (averageDistance < 2) {
    return 10
  }

  const rawScore = 10 - 0.12 * (averageDistance - 2)
  return clamp(rawScore, 0, 10)
}
