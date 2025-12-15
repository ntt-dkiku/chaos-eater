from pydantic.v1 import BaseModel, Field

TEMPLATE_TEMPLATE = """
- name

"""

class FaultBase:
    def __init__(self, pydantic_object: BaseModel) -> None:
        self.__pydantic_object = pydantic_object

    @property
    def pydantic_object(self):
        return self.get_pydantic_object
    
    def get_template(self, params: dict) -> str:
        pass