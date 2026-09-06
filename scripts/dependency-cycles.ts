export function findDependencyCycles<Node>(
  nodes: readonly Node[],
  nodeName: (node: Node) => string,
  dependenciesForNode: (node: Node) => readonly (string | undefined)[],
) {
  const nodeNames = new Set(nodes.map(nodeName))
  const dependencies = new Map(
    nodes.map((node) => [
      nodeName(node),
      dependenciesForNode(node)
        .filter(
          (dependency): dependency is string =>
            dependency !== undefined && nodeNames.has(dependency),
        )
        .toSorted((left, right) => left.localeCompare(right)),
    ]),
  )
  const visited = new Set<string>()
  const active = new Set<string>()
  const stack: string[] = []
  const cycles = new Set<string>()

  for (const name of [...nodeNames].toSorted((left, right) => left.localeCompare(right)))
    visitDependencies(name, dependencies, visited, active, stack, cycles)
  return [...cycles]
}

function visitDependencies(
  node: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
  visited: Set<string>,
  active: Set<string>,
  stack: string[],
  cycles: Set<string>,
) {
  if (visited.has(node)) return
  visited.add(node)
  active.add(node)
  stack.push(node)

  for (const dependency of dependencies.get(node) ?? []) {
    if (!visited.has(dependency))
      visitDependencies(dependency, dependencies, visited, active, stack, cycles)
    else if (active.has(dependency)) {
      const cycle = stack.slice(stack.indexOf(dependency))
      cycles.add(canonicalCycle(cycle))
    }
  }

  stack.pop()
  active.delete(node)
}

function canonicalCycle(cycle: readonly string[]) {
  const start = cycle.reduce(
    (lowest, node, index) => (node.localeCompare(cycle[lowest]!) < 0 ? index : lowest),
    0,
  )
  const ordered = [...cycle.slice(start), ...cycle.slice(0, start)]
  return [...ordered, ordered[0]].join(' -> ')
}
