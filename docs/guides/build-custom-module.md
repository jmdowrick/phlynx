# Using Custom Modules in PhLynx

Sometimes the model you wish to build will require you to create your own CellML modules. In these instances, you will need to upload additional information to ensure you can export your model.

## Create Your Custom Module

Using your IDE of choice, write your custom CellML modules following the conventions described in the [Module Format](../reference/cellml-module-format) help guide.

## Import Your CellML File

Import your CellML file by clicking the downward facing arrow next to "Import" in the Toolbar. Select the "CellML file" option, and your modules will appear in the Module List.

## Import Parameter File

PhLynx currently requires the user to upload a parameter.csv file to determine which variables are *constants* or *global constants*. Parameter names in the parameter file must follow the naming convention required by Circulatory Autogen ([module_name]_[parameter_name] for *constants* and [parameter_name] for *global constants*).

> [!NOTE]
> It is essential that these exactly match parameter and module names in PhLynx.

Again, to upload this information press the downward facing arrow next to "Import" in the Toolbar. This time, select the "Parameters" option. A file dialog will appear. Select the parameter.csv file and press "Import" to confirm.

## Import Units File

One of the benefits of being built on CellML is that dimensional consistency validation is innate to PhLynx. However, this requires any custom units to be defined in a units CellML file. In the rare instance that one or more of the units in your module aren't already defined within the PhLynx unit files, you will need to create and import a custom unit.cellml file. 

A brief primer on writing a unit definition file is provided [here](../reference/cellml-units-file). For a more in-depth description, see the official [CellML documentation](https://www.cellml.org/specifications/archive/20030930/units.pdf).

## Build your model

With the above information provided, you can use your custom module as you would with the modules already present in the <GlossaryLink term="module-list"/>.
