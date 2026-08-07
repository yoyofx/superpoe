import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const surface = new URLSearchParams(location.search).get('surface')
const Root = surface === 'price-check'
  ? React.lazy(() => import('./priceCheck/PriceCheckApp').then((module) => ({ default: module.PriceCheckApp })))
  : React.lazy(() => import('./App').then((module) => ({ default: module.default })))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><React.Suspense fallback={null}><Root /></React.Suspense></React.StrictMode>,
)
