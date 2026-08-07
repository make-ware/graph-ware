class GraphClass {
    constructor(data: any) { }
}

class NodeClass {
    constructor(data: any) { }
}

const testDataElement = new GraphClass({
    uid: 'testDataElement',
    name: 'test',
    label: 'Test Element Data',
    graphs: [
        new GraphClass({
            uid: 'BatterySystem',
            name: 'battery_system',
            label: 'Test Element Data',
            elements: [
                new NodeClass({
                    name: 'house_battery_1',
                    label: 'House Battery 1',
                    attributes: [
                        {
                            name: 'voltage',
                            value: '12',
                            unit: 'volts',
                            kind: 'power'
                        },
                        {
                            name: 'current',
                            value: '150',
                            unit: 'amps',
                            kind: 'power'
                        }
                    ],
                    ports: [
                        {
                            name: 'supply',
                            direction: 'output',
                            relationship: 'one',
                            kind: 'power'
                        }
                    ]
                }),
                new NodeClass({
                    name: 'house_battery_2',
                    label: 'House Battery 2',
                    attributes: [
                        {
                            name: 'voltage',
                            value: '12',
                            unit: 'volts',
                            kind: 'power'
                        },
                        {
                            name: 'current',
                            value: '150',
                            unit: 'amps',
                            kind: 'power'
                        }
                    ],
                    ports: [
                        {
                            name: 'supply',
                            direction: 'output',
                            relationship: 'one',
                            kind: 'power'
                        }
                    ]
                }),
                new NodeClass({
                    name: 'house_fuse',
                    label: 'Fuse',
                    attributes: [
                        {
                            name: 'voltage',
                            value: '12',
                            unit: 'volts',
                            kind: 'power'
                        },
                        {
                            name: 'current',
                            value: '150',
                            unit: 'amps',
                            kind: 'power'
                        }
                    ],
                    ports: [
                        {
                            name: 'supply',
                            direction: 'output',
                            relationship: 'many',
                            kind: 'power'
                        },
                        {
                            name: 'supply',
                            direction: 'input',
                            relationship: 'many',
                            kind: 'power'
                        }
                    ]
                })
            ]
        }),
        new GraphClass({
            uid: 'EngineSystem',
            name: 'control_system',
            label: 'Test Element Data',
            elements: [
                new NodeClass({
                    name: 'victron_cerbo',
                    label: 'Cerbo GX',
                    ports: [
                        {
                            name: 'supply',
                            direction: 'input',
                            kind: 'power',
                            isRequired: true,
                            attributes: [
                                {
                                    name: 'voltage',
                                    value: '12',
                                    unit: 'volts',
                                    kind: 'power',
                                    filter: {
                                        logicalOperator: 'AND',
                                        conditions: [
                                            {
                                                attribute: 'voltage',
                                                value: '10',
                                                operator: 'gte'
                                            },
                                            {
                                                attribute: 'voltage',
                                                value: '15',
                                                operator: 'lte'
                                            }
                                        ]
                                    }
                                },
                                {
                                    name: 'current',
                                    value: '3',
                                    unit: 'amps',
                                    kind: 'power'
                                }
                            ]
                        },
                        {
                            name: 'hdmi',
                            direction: 'output',
                            kind: 'video/hdmi'
                        },
                        {
                            name: 'vcan_1',
                            direction: 'output',
                            kind: 'data/canbus'
                        },
                        {
                            name: 'vcan_2',
                            direction: 'output',
                            kind: 'data/canbus'
                        },
                        {
                            name: 'vbus_1',
                            direction: 'output',
                            kind: 'data/vbus'
                        },
                        {
                            name: 'vbus_2',
                            direction: 'output',
                            kind: 'data/vbus'
                        }
                    ]
                })
            ]
        })
    ]
});

export default testDataElement;
