import { Parser } from 'n3'

export function processTurtle(turtleFile) {
  const parser = new Parser()
  const quads = parser.parse(turtleFile);
  return quads
}
