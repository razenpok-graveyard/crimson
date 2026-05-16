export function vectorNameMarker(name: string): string {
  return `__vector__:${name}`;
}

export function vectorArrayNameMarker(name: string): string {
  return `__vector_array__:${name}`;
}

export function stringNameMarker(name: string): string {
  return `__string__:${name}`;
}

export function colorNameMarker(name: string): string {
  return `__color__:${name}`;
}

export function rectangleNameMarker(name: string): string {
  return `__rectangle__:${name}`;
}

export function setNameMarker(name: string): string {
  return `__set__:${name}`;
}

export function objectNameMarker(name: string): string {
  return `__object__:${name}`;
}

export function pythonMappingNameMarker(name: string): string {
  return `__python_mapping__:${name}`;
}

export function dateNameMarker(name: string): string {
  return `__date__:${name}`;
}

export function pathNameMarker(name: string): string {
  return `__path__:${name}`;
}

export function pathArrayNameMarker(name: string): string {
  return `__path_array__:${name}`;
}

export function nullableNameMarker(name: string): string {
  return `__nullable__:${name}`;
}

export function tupleKeyMapNameMarker(name: string): string {
  return `__tuple_key_map__:${name}`;
}

export function arrayValueMapNameMarker(name: string): string {
  return `__array_value_map__:${name}`;
}

export function mapValueMapNameMarker(name: string): string {
  return `__map_value_map__:${name}`;
}

export function mapValueTypeMarker(name: string): string {
  return `__map_value_type__:${name}`;
}

export function numberArrayNameMarker(name: string): string {
  return `__number_array__:${name}`;
}

export function numberNameMarker(name: string): string {
  return `__number__:${name}`;
}

export function tupleElementArrayNameMarker(name: string): string {
  return `__tuple_element_array__:${name}`;
}

export function receiverTypeNameMarker(name: string): string {
  return `__receiver_type__:${name}`;
}

export function classFieldTypeMarker(className: string, fieldName: string): string {
  return `__class_field_type__:${className}:${fieldName}`;
}

export function classBaseTypeMarker(className: string): string {
  return `__class_base_type__:${className}`;
}

export function functionReturnTypeMarker(functionName: string): string {
  return `__function_return_type__:${functionName}`;
}

export function staticClassMethodNameMarker(className: string, methodName: string): string {
  return `__static_class_method__:${className}:${methodName}`;
}

export function instanceMethodSignatureMarker(className: string, methodName: string): string {
  return `__instance_method_signature__:${className}:${methodName}`;
}
