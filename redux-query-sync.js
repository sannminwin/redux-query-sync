import createHistory from 'history/createBrowserHistory'

/**
 * Sets up bidirectional synchronisation between a Redux store and window
 * location query parameters.
 *
 * @param {Object} options.store - The redux store object (= an object `{dispatch, getState}`).
 * @param {Object} options.params - The query parameters in the location to keep in sync.
 * @param {*} options.params[].defaultValue - The value corresponding to absence of the
 *     parameter.
 * @param {function} options.params[].action - The action creator to be invoked with the parameter
 *     value to set it in the store.
 * @param {function} options.params[].selector - The function that gets the value given the state.
 * @param {boolean} options.replaceState - If truthy, update location using
 *     history.replaceState instead of history.pushState, to not fill the browser history.
 * @param {string} options.initialTruth - If set, indicates whose values to sync to the other,
 *     initially. Can be either 'location' or 'store'.
 */
function ReduxQuerySync({
    store,
    params,
    replaceState,
    initialTruth,
}) {
    const { dispatch } = store

    const history = createHistory()

    const updateLocation = replaceState
        ? history.replace.bind(history)
        : history.push.bind(history)

    // A bit of state used to not respond to self-induced location updates.
    let ignoreLocationUpdate = false

    // Keeps the last seen values for comparing what has changed.
    let lastQueryValues = {}

    function getQueryValues(location) {
        const locationParams = new URL('http://bogus' + location.search).searchParams
        const queryValues = {}
        Object.keys(params).forEach(param => {
            const { defaultValue } = params[param]
            let value = locationParams.get(param)
            if (value === null) {
                value = defaultValue
            }
            queryValues[param] = value
        })
        return queryValues
    }

    function handleLocationUpdate(location) {
        // Ignore the event if the location update was induced by ourselves.
        if (ignoreLocationUpdate) return

        const state = store.getState()

        // Read the values of the watched parameters
        const queryValues = getQueryValues(location)

        // For each parameter value that changed, call the corresponding action.
        Object.keys(queryValues).forEach(param => {
            const value = queryValues[param]
            if (value !== lastQueryValues[param]) {
                const { selector, action } = params[param]
                lastQueryValues[param] = value

                // Dispatch the action to update the state if needed.
                // (except on initialisation, this should always be needed)
                if (selector(state) !== value) {
                    dispatch(action(value))
                }
            }
        })
    }

    function handleStateUpdate() {
        const state = store.getState()
        const location = history.location

        // Parse the current location's query string.
        const locationParams = new URL('http://bogus' + location.search).searchParams

        // Replace each configured parameter with its value in the state.
        Object.keys(params).forEach(param => {
            const { selector, defaultValue } = params[param]
            const value = selector(state)
            if (value === defaultValue) {
                locationParams.delete(param)
            } else {
                locationParams.set(param, value)
            }
        })
        const newLocationSearchString = `?${locationParams}`

        // Only update location if anything changed.
        if (newLocationSearchString !== location.search) {
            // Update location (but prevent triggering a state update).
            ignoreLocationUpdate = true
            updateLocation({search: newLocationSearchString})
            ignoreLocationUpdate = false
        }
    }

    // Sync location to store on every location change, and vice versa.
    const unsubscribeFromLocation = history.listen(handleLocationUpdate)
    const unsubscribeFromStore = store.subscribe(handleStateUpdate)

    // Sync location to store now, or vice versa, or neither.
    if (initialTruth === 'location') {
        handleLocationUpdate(history.location)
    } else {
        // Just set the last seen values to later compare what changed.
        lastQueryValues = getQueryValues(history.location)
    }
    if (initialTruth === 'store') {
        handleStateUpdate()
    }

    return function unsubscribe() {
        unsubscribeFromLocation()
        unsubscribeFromStore()
    }
}

/**
 * For convenience, one can set up the synchronisation by passing this enhancer to createStore.
 *
 * @example
 *
 *     const storeEnhancer = ReduxQuerySync.enhancer({params, initialTruth: 'location'})
 *     const store = createStore(reducer, initialState, storeEnhancer)
 *
 * Arguments are equal to those of ReduxQuerySync itself, except that `store` can now be omitted.
 */
ReduxQuerySync.enhancer = function makeStoreEnhancer(config) {
    return storeCreator => (reducer, initialState, enhancer) => {
        // Create the store as usual.
        const store = storeCreator(reducer, initialState, enhancer)

        // Hook up our listeners.
        ReduxQuerySync({store, ...config})

        return store
    }
}

export default ReduxQuerySync
