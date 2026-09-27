import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SirenIcon from './SirenIcon'

describe('SirenIcon', () => {
  it('renders an svg with the default size', () => {
    const { container } = render(<SirenIcon />)
    const svg = container.querySelector('svg')!
    expect(svg).toBeInTheDocument()
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
  })

  it('renders with a custom size', () => {
    const { container } = render(<SirenIcon size={32} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('32')
    expect(svg.getAttribute('height')).toBe('32')
  })

  it('has aria-hidden set', () => {
    const { container } = render(<SirenIcon />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
