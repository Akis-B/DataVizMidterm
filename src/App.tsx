import type { MouseEvent } from 'react'
import './App.css'

const GRID_SIZE = 12

function App() {
  return (
    <main className="app">
      <div className="app__canvas">
        {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => (
          <Cell key={index} index={index} />
        ))}
      </div>
    </main>
  )
}

export default App

function Cell({ index }: { index: number }) {
  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    const colors = ['#2ED573', '#FF4757', '#FFEA61']
    const randomColor = colors[Math.floor(Math.random() * colors.length)]
    event.currentTarget.style.backgroundColor = randomColor
  }

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.backgroundColor = '#160B06'
  }

  return (
    <button
      type="button"
      className="app__cell"
      aria-label={`Cell ${Math.floor(index / GRID_SIZE) + 1}, ${index % GRID_SIZE + 1}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    />
  )
}
