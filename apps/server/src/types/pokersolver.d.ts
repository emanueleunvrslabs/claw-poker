declare module 'pokersolver' {
  export class Hand {
    name: string
    rank: number
    cards: { value: string; suit: string }[]
    static solve(cards: string[]): Hand
    static winners(hands: Hand[]): Hand[]
  }
}
