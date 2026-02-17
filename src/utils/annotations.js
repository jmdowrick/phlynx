import { Parser } from 'n3'

export function loadTurtle(turtleFile) {

    const parser = new Parser()

    const quads = parser.parse(turtleFile);

    quads.forEach((quad) => {
        console.log(quad.subject.value);
        console.log(quad.predicate.value);
        console.log(quad.object.value);
    });

    return quads
}