import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const surface = new URLSearchParams(location.search).get('surface')
const Root = surface === 'price-check'
  ? React.lazy(() => import('./priceCheck/PriceCheckApp').then((module) => ({ default: module.PriceCheckApp })))
  : surface === 'find-better'
    ? React.lazy(() => import('./priceCheck/FindBetterApp').then((module) => ({ default: module.FindBetterApp })))
  : surface === 'price-check-detail'
    ? React.lazy(() => import('./priceCheck/PriceCheckDetailApp').then((module) => ({ default: module.PriceCheckDetailApp })))
    : surface === 'price-check-mask'
      ? React.lazy(() => import('./priceCheck/PriceCheckMaskApp').then((module) => ({ default: module.PriceCheckMaskApp })))
      : surface === 'equipment-try-on'
        ? React.lazy(() => import('./components/equipment/EquipmentTryOnWindow').then((module) => ({ default: module.EquipmentTryOnWindow })))
    : React.lazy(() => import('./App').then((module) => ({ default: module.default })))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><React.Suspense fallback={null}><Root /></React.Suspense></React.StrictMode>,
)
